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

      // Healthcheck antes de iniciar conforme SPEC
      const isHealthy = await this.checkHealth();
      if (!isHealthy) {
        console.warn('[NavigationEngine] Healthcheck falhou (Porta 3001 ocupada ou offline). Aguardando 1m...');
        await new Promise(resolve => setTimeout(resolve, 60000));
        continue;
      }

      const browser = await chromium.launch({ headless: false });
      const context = await browser.newContext();
      const mainPage = await context.newPage();

      // Timeout de Navegação conforme SPEC
      mainPage.setDefaultNavigationTimeout(30000);

      const applicationsLog: any[] = [];

      try {
        for (const keyword of keywords) {
          console.log(`[NavigationEngine] Processando Keyword: ${keyword}`);
          await this.processKeyword(context, mainPage, keyword, applicationsLog);
        }

        // Notificação após esgotar keywords
        await this.notificationService.sendDailySummary(applicationsLog);

      } catch (error) {
        console.error('[NavigationEngine] Erro crítico no motor:', error);
      } finally {
        await browser.close();
      }

      console.log('[NavigationEngine] Ciclo concluído. Aguardando 24h...');
      await new Promise(resolve => setTimeout(resolve, 24 * 60 * 60 * 1000));
    }
  }

  /**
   * Processa uma keyword específica (usado pelo Worker ou pelo loop principal).
   */
  public async processKeyword(context: BrowserContext, mainPage: Page, keyword: string, log: any[], job?: Job) {
    // Heartbeat
    if (job) {
      await job.log(`Iniciando Step 1.1 para: ${keyword}`);
      await job.updateProgress(10);
    }

    // 1. ENTRY_POINT e Navegação (1.1 ou 1.2)
    await this.sapoAdapter.entryPoint(mainPage, keyword, job);

    let hasNextPage = true;
    while (hasNextPage) {
      // 1.2 Processamento de Vagas na página atual
      const jobUrls = await this.sapoAdapter.getJobUrls(mainPage);

      if (job) await job.log(`Encontradas ${jobUrls.length} vagas na página.`);

      for (const [index, url] of jobUrls.entries()) {
        // Heartbeat por vaga
        if (job) {
          await job.log(`Processando vaga ${index + 1}/${jobUrls.length}: ${url}`);
          await job.updateProgress(Math.min(90, 20 + index * 5));
        }

        // Duplicar Tab (preservar lista)
        const detailPage = await context.newPage();
        detailPage.setDefaultNavigationTimeout(30000);

        try {
          // Transaction Guard: Listener para Diálogos/Popups (SPEC 3)
          detailPage.on('dialog', async dialog => {
            console.log(`[NavigationEngine] Diálogo detectado: ${dialog.message()}`);
            await dialog.dismiss().catch(() => { });
          });

          await detailPage.goto(url, { waitUntil: 'load', timeout: 30000 });

          // Executar 1.3 (Application)
          const success = await this.sapoAdapter.applyToJobSpec(detailPage, job);

          if (success) {
            log.push({ url, title: 'Vaga Sapo', company: 'Check DB', location: 'Lisboa' });
            await detailPage.close(); // SPEC 1: SÓ FECHA EM SUCESSO
          } else {
            console.warn(`[NavigationEngine] Candidatura interrompida para ${url}. Tab mantida aberta para inspeção.`);
            if (job) await job.log(`AVISO: Verifique a tab aberta para a vaga ${url}`);
          }
        } catch (err: any) {
          console.error(`[NavigationEngine] Erro crítico na vaga ${url}:`, err);
          if (job) await job.log(`ERRO CRÍTICO: ${err.message}. Tab mantida aberta.`);
        }
        // Nota: Removido o close do finally para respeitar a SPEC de Transaction Guard
      }

      // Pagination
      hasNextPage = await this.sapoAdapter.goToNextPage(mainPage);
      if (job && hasNextPage) await job.log('Avançando para próxima página...');
    }
  }

  private async checkHealth(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get('http://localhost:3001', (res) => {
        resolve(res.statusCode === 200 || res.statusCode === 404); // Aceita se responder
      });
      req.on('error', () => resolve(false));
      req.end();
    });
  }
}
