import { Injectable } from '@nestjs/common';
import { chromium, Page, BrowserContext } from 'playwright';
import * as http from 'http';
import { SapoAdapter } from '../adapters/SapoAdapter';
import { NotificationService } from './NotificationService';
import { Job } from 'bullmq';

@Injectable()
export class NavigationEngine {
  constructor(
    private sapoAdapter: SapoAdapter,
    private notificationService: NotificationService
  ) { }

  /**
   * Ciclo infinito de 24h conforme SPEC.
   */
  async runInfiniteLoop(keywords: string[]) {
    while (true) {
      console.log(`[NavigationEngine] Iniciando execução diária: ${new Date().toLocaleString()}`);

      let browser: any;
      let context: any;
      let mainPage: any;

      const initBrowser = async () => {
        const cfEnv = (this as any).cloudflareEnv;
        if (cfEnv?.BROWSER) {
          console.log('[NavigationEngine] Usando Cloudflare Browser Rendering...');
          browser = await cfEnv.BROWSER.launch();
        } else {
          console.log('[NavigationEngine] Usando Chromium Local...');
          browser = await chromium.launch({ headless: false });
        }
        context = await browser.newContext();
        
        // Anti-Adware global listener
        context.on('page', async (page: any) => {
          const url = page.url();
          if (url !== 'about:blank' && !url.includes('sapo.pt')) {
            console.log(`[NavigationEngine] Fechando aba externa: ${url}`);
            await page.close().catch(() => {});
          }
        });

        mainPage = await context.newPage();
        mainPage.setDefaultNavigationTimeout(30000);
        console.log('[Anchor] Navegando para base: https://emprego.sapo.pt/');
        await mainPage.goto('https://emprego.sapo.pt/', { waitUntil: 'networkidle' });
      };

      await initBrowser();
      const applicationsLog: any[] = [];

      try {
        for (const keyword of keywords) {
          let attempts = 0;
          let success = false;
          const MAX_RETRIES = 3;

          while (attempts < MAX_RETRIES && !success) {
            attempts++;
            try {
              // Validar se o browser/página ainda estão vivos antes de processar (SPEC 1)
              if (mainPage.isClosed() || browser.isConnected() === false) {
                throw new Error('Target closed or browser disconnected');
              }

              console.log(`[NavigationEngine] Processando Keyword: ${keyword} (Tentativa ${attempts}/${MAX_RETRIES})`);
              
              if (attempts > 1) {
                console.log(`[Anchor] Voltando para Home devido a erro na keyword "${keyword}"...`);
                await mainPage.goto('https://emprego.sapo.pt/', { waitUntil: 'networkidle' });
              }

              await this.processKeyword(context, mainPage, keyword, applicationsLog);
              success = true;
            } catch (error: any) {
              console.error(`[NavigationEngine] Erro na keyword "${keyword}" (Tentativa ${attempts}):`, error.message);
              
              // SPEC 1: Hard Reset se o browser/contexto fechar
              if (error.message.includes('closed') || error.message.includes('disconnected')) {
                console.warn('[NavigationEngine] Hard Reset detectado. Reiniciando browser...');
                await browser.close().catch(() => {});
                await initBrowser();
              } else {
                const pages = context.pages();
                for (const p of pages) {
                  if (p !== mainPage && !p.isClosed()) await p.close().catch(() => {});
                }
              }

              if (attempts >= MAX_RETRIES) {
                console.warn(`[Skipped] Keyword "${keyword}" falhou após ${MAX_RETRIES} tentativas.`);
              } else {
                await new Promise(resolve => setTimeout(resolve, 5000));
              }
            }
          }
        }

        await this.notificationService.sendDailySummary(applicationsLog);
        console.log('[NavigationEngine] Ciclo diário concluído. Reiniciando processo (SPEC 3)...');
        process.exit(0);

      } catch (error) {
        console.error('[NavigationEngine] Erro crítico no motor:', error);
      } finally {
        if (browser) await browser.close().catch(() => {});
      }

      console.log('[NavigationEngine] Ciclo concluído. Aguardando 24h...');
      await new Promise(resolve => setTimeout(resolve, 24 * 60 * 60 * 1000));
    }
  }

  /**
   * Processa uma keyword específica (usado pelo Worker ou pelo loop principal).
   */
  public async processKeyword(context: BrowserContext, mainPage: Page, keyword: string, log: any[], job?: Job) {
    // 1. ENTRY_POINT e Navegação (1.1 ou 1.2)
    await this.cleanNonSapoTabs(context);
    await mainPage.bringToFront();
    await this.sapoAdapter.entryPoint(mainPage, keyword, job);

    // SPEC 1: Consulta de Quota (Prisma Query)
    const limit = parseInt(process.env.NUMBER_OF_JOB_APPLIES_PER_KEYWORD_PER_DAY || '5', 10);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let currentAppliedCount = await (this.sapoAdapter as any).prisma.jobApplication.count({
      where: {
        keyword: keyword,
        createdAt: { gte: today },
        status: 'APPLIED'
      }
    });

    console.log(`[NavigationEngine] Quota para "${keyword}": ${currentAppliedCount}/${limit}`);

    let hasNextPage = true;
    while (hasNextPage) {
      const jobUrls = await this.sapoAdapter.getJobUrls(mainPage);

      for (const [index, url] of jobUrls.entries()) {
        // SPEC 2: Interrupção de Fluxo (Quota Check)
        if (currentAppliedCount >= limit) {
          console.log(`[Quota Atingida] Keyword: "${keyword}" atingiu o limite de ${limit} candidaturas hoje.`);
          return;
        }

        // Anti-Duplicação
        const alreadyApplied = await (this.sapoAdapter as any).prisma.jobApplication.findUnique({
          where: { jobId: url }
        });

        if (alreadyApplied && alreadyApplied.status === 'APPLIED') {
          console.log(`[NavigationEngine] Vaga já aplicada anteriormente: ${url}. Ignorando.`);
          continue;
        }

        await this.cleanNonSapoTabs(context);
        const pages = context.pages();
        if (pages.length >= 2) {
          for (const p of pages) { if (p !== mainPage) await p.close().catch(() => {}); }
        }

        // SPEC 2: Resiliência por Vaga (Per-Vacancy Retry Logic)
        let vacancyAttempts = 0;
        const MAX_VACANCY_RETRIES = 4;
        let vacancySuccess = false;

        const detailPage = await context.newPage();
        await detailPage.bringToFront();
        detailPage.setDefaultNavigationTimeout(30000);

        while (vacancyAttempts < MAX_VACANCY_RETRIES && !vacancySuccess) {
          vacancyAttempts++;
          try {
            if (vacancyAttempts === 1) {
              await detailPage.goto(url, { waitUntil: 'load', timeout: 30000 });
            } else {
              console.log(`[NavigationEngine] Retry Vaga (${vacancyAttempts}/${MAX_VACANCY_RETRIES}): ${url}`);
              await detailPage.reload({ waitUntil: 'load' });
            }

            // SPEC 1: Domain Anchor / Whitelist de Fluxo
            const currentUrl = detailPage.url();
            const isWhitelisted = ['/offers', '/search-results', '/detalhe', '/candidatura', 'login.sapo.pt'].some(p => currentUrl.includes(p));
            
            if (!isWhitelisted && !currentUrl.includes('about:blank')) {
              console.warn(`[NavigationEngine] URL fora de fluxo detectada: ${currentUrl}. Fazendo reset...`);
              await detailPage.close().catch(() => {});
              vacancySuccess = false; 
              break;
            }

            await detailPage.keyboard.press('Escape'); // Anti-Stuck Ads

            // Executar 1.3 (Application)
            vacancySuccess = await this.sapoAdapter.applyToJobSpec(detailPage, job, keyword);

            if (vacancySuccess) {
              currentAppliedCount++;
              log.push({ url, title: 'Vaga Sapo', company: 'Check DB', location: 'Lisboa' });
              if (job) await job.log(`Candidatura ${currentAppliedCount}/${limit} enviada com sucesso.`);
              await detailPage.close();
            }
          } catch (err: any) {
            console.error(`[NavigationEngine] Erro na vaga (Tentativa ${vacancyAttempts}):`, err.message);
            if (vacancyAttempts >= MAX_VACANCY_RETRIES) {
              if (job) await job.log(`[Skipped] Vaga falhou após ${MAX_VACANCY_RETRIES} tentativas.`);
              await detailPage.close();
            } else {
              await new Promise(resolve => setTimeout(resolve, 3000));
            }
          }
        }
      }

      hasNextPage = await this.sapoAdapter.goToNextPage(mainPage);
    }
  }

  private async cleanNonSapoTabs(context: BrowserContext) {
    const pages = context.pages();
    for (const page of pages) {
      const url = page.url();
      if (url !== 'about:blank' && !url.includes('sapo.pt')) {
        await page.close().catch(() => {});
      }
    }
  }

  private async checkHealth(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get('http://localhost:3001', (res) => {
        resolve(res.statusCode === 200 || res.statusCode === 404);
      });
      req.on('error', () => resolve(false));
      req.end();
    });
  }
}
