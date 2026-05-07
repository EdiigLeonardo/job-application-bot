import { Injectable } from '@nestjs/common';
import { Page } from 'playwright';
import { JobBoardAdapter, ScrapedJob } from '../interfaces/JobBoardAdapter';
import { IntelligenceService } from '../services/IntelligenceService';
import { Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

@Injectable()
export class SapoAdapter implements JobBoardAdapter {
  public readonly platform = 'SapoEmprego';
  private prisma = new PrismaClient();

  constructor(private intelligence: IntelligenceService) { }

  /**
   * ENTRY_POINT: Decide entre Navegação Inicial (1.1) ou Processamento Direto (1.2).
   */
  async entryPoint(page: Page, keyword: string, job?: Job) {
    const url = page.url();
    // Se a URL já contém os parâmetros de pesquisa, assume que estamos em 1.2
    if (url.includes('pesquisa=') && (url.includes('local=') || url.includes('search-results'))) {
      console.log('[Sapo] ENTRY_POINT: URL com parâmetros detetada. Saltando para 1.2.');
      if (job) await job.log('ENTRY_POINT: Saltando para 1.2 (URL parametrizada).');
      return;
    }

    console.log('[Sapo] ENTRY_POINT: Iniciando Fluxo 1.1 (Navegação Inicial).');
    await this.step11InitialNavigation(page, keyword, job);
  }

  /**
   * 1.1 (Navegação Inicial)
   */
  async step11InitialNavigation(page: Page, keyword: string, job?: Job) {
    console.log('[Sapo][SapoAdapter][step11InitialNavigation] Step 1.1: Iniciando navegação inicial...');
    await page.goto('https://emprego.sapo.pt/', { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Race Condition: Aceitar Cookies com timeout curto (2s)
    if (job) await job.log('Step 1.1: Gerindo cookies e popups...');
    await page.waitForSelector('#qc-cmp2-ui button[mode="primary"]', { timeout: 2000 }).then(async (el) => {
      await el.click();
    }).catch(() => {});

    await this.handlePopups(page);

    // Non-Blocking Inputs: Usando page.evaluate conforme SPEC
    if (job) await job.log(`Step 1.1: Preenchendo keyword "${keyword}"...`);
    await page.evaluate((kw) => {
      console.log('[Sapo][SapoAdapter][step11InitialNavigation] Step 1.1: Preenchendo keyword...')
      const input = document.querySelector('input#search') as HTMLInputElement;
      if (input) {
        input.value = kw;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, keyword);

    // Dropdown: Selecionar "Lisboa"
    await page.click('button.ink-button:has-text("Distrito"), button.ink-button:has-text("Lisboa")');
    await page.click('label[for="dest11"]');

    if (job) await job.updateProgress(15);

    // Trigger: Promise.race entre o botão e popups inesperados
    if (job) await job.log('Step 1.1: Clicando em PROCURAR...');
    await Promise.race([
      page.click('button.ink-button.main-action:has-text("PROCURAR")'),
      page.waitForSelector('.ink-button.close-highimpact', { timeout: 10000 }).then(el => el.click())
    ]).catch(() => { });

    await page.waitForSelector('article h3 a', { timeout: 30000 }).catch(() => {
      console.warn('[Sapo] Timeout aguardando resultados da pesquisa. Verificando se a página carregou...');
    });
  }

  /**
   * 1.2 (Processamento de Vagas)
   */
  async getJobUrls(page: Page): Promise<string[]> {
    console.log('[Sapo][SapoAdapter][getJobUrls] Step 1.2: Iniciando...')
    // Validar URL de pesquisa
    const currentUrl = page.url();
    if (!currentUrl.includes('pesquisa=')) {
      console.warn('[Sapo] Alerta: URL de resultados pode estar incorreta:', currentUrl);
    }

    await this.handlePopups(page);

    // Extrair links das ofertas
    const links = await page.$$eval('article h3 a', (els) =>
      els.map(el => (el as HTMLAnchorElement).href)
    );

    return links;
  }

  /**
   * 1.3 (Candidatura & Form)
   */
  async applyToJobSpec(page: Page, job?: Job): Promise<boolean> {
    console.log('[Sapo][SapoAdapter][applyToJobSpec] Step 1.3: Iniciando...')
    await this.handlePopups(page);

    // Seletor de Botão: Primeiro elemento com texto "CANDIDATE-SE" (case insensitive)
    const applyButton = page.locator('text=/CANDIDATE-SE/i').first();
    await applyButton.waitFor({ state: 'visible', timeout: 10000 }).catch(() => { });

    if (!(await applyButton.isVisible())) {
      console.log('[Sapo][SapoAdapter][applyToJobSpec] Botão "CANDIDATE-SE" não encontrado ou oculto.');
      // Tentar verificar se o formulário já está visível
      if (await page.locator('#nome').isVisible()) {
        console.log('[Sapo][SapoAdapter][applyToJobSpec] Formulário já visível, prosseguindo.');
      } else {
        return false;
      }
    } else {
      await applyButton.scrollIntoViewIfNeeded();
      await applyButton.click({ force: true });
    }

    // Aguardar o formulário aparecer (basta o seletor crítico)
    await page.waitForSelector('#nome, input[name*="nome"]', { timeout: 5000 })
      .catch(() => console.log('[Sapo] Aviso: Formulário não detetado imediatamente, tentando prosseguir...'));

    // Extrair metadados para persistência
    const title = await page.locator('h1').first().innerText().catch(() => 'Vaga Sapo');
    const company = await page.locator('.company-name').first().innerText().catch(() => 'Empresa Sapo');

    try {
      // 1. UPLOAD CV (SPEC 1)
      const uploadSuccess = await this.uploadCV(page, job);
      if (!uploadSuccess) {
        await this.logFailure(page, title, company, 'Upload_Error');
        return false;
      }

      // 2. DADOS PESSOAIS & CHECKBOX (SPEC 2)
      await this.handleApplicationForm(page, job);

      // Submissão (SPEC 1.3.6)
      console.log('[Sapo] Submetendo formulário...');
      await page.click('button:has-text("ENVIAR CANDIDATURA")');

      // Validação de Sucesso (SPEC 1.3.5 / Sucesso no Tooltip/Texto)
      const successIndicator = page.locator('text=/sucesso/i, .success, .alert-success').first();
      try {
        await successIndicator.waitFor({ state: 'visible', timeout: 15000 });
        console.log('[Sapo] Mensagem de SUCESSO detectada.');
      } catch (e) {
        // Se falhar, verificar se há erro de captcha
        const errorText = await page.locator('.error, .alert-danger').innerText().catch(() => '');
        if (errorText.toLowerCase().includes('captcha inválido')) {
          console.log('[Sapo] Captcha detectado na submissão. Aguardando...');
          await this.waitForCaptcha(page);
          await page.click('button:has-text("ENVIAR CANDIDATURA")');
          await successIndicator.waitFor({ state: 'visible', timeout: 15000 });
        } else {
          throw new Error(`Candidatura não confirmada. Erro: ${errorText}`);
        }
      }

      // Finalização: Sucesso -> Logar na Database
      console.log(`[Sapo] Candidatura enviada com sucesso para ${title}. Registando na DB.`);

      await this.prisma.jobApplication.upsert({
        where: { jobId: page.url() },
        update: { status: 'APPLIED', updatedAt: new Date() },
        create: {
          jobId: page.url(),
          platform: 'SapoEmprego',
          title: title,
          company: company,
          status: 'APPLIED'
        }
      });

      return true;
    } catch (error) {
      console.error('[Sapo] Erro crítico no fluxo 1.3:', error);
      return false;
    }
  }

  /**
   * SPEC 1: Upload de CV com Verificação
   */
  private async uploadCV(page: Page, job?: Job): Promise<boolean> {
    const cvPath = path.resolve(process.env.CV_PATH || 'assets/cv.pdf');
    console.log(`[Sapo][Upload] Iniciando upload: ${cvPath}`);
    if (job) await job.log(`Iniciando upload de CV: ${path.basename(cvPath)}`);

    try {
      const fileInput = page.locator('input[type="file"]');
      
      // Detetar botão e disparar fileChooser se necessário
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null),
        page.click('button:has-text("Escolher"), .ink-button:has-text("Escolher"), text=/Adicionar CV/i', { timeout: 3000 }).catch(() => {})
      ]);

      if (fileChooser) {
        await fileChooser.setFiles(cvPath);
      } else {
        await fileInput.setInputFiles(cvPath);
      }

      // Verificação de Upload (Aguardar indicador visual)
      // No SAPO, geralmente aparece o nome do ficheiro ou um checkmark
      await page.waitForSelector('text=/Carregado|Sucesso|cv.pdf/i', { timeout: 15000 })
        .catch(() => console.log('[Sapo][Upload] Aviso: Confirmação visual de upload não detectada.'));

      if (job) await job.updateProgress(25);
      return true;
    } catch (error) {
      console.error('[Sapo][Upload] Erro fatal no upload:', error);
      return false;
    }
  }

  /**
   * SPEC 2: Preenchimento e Validação do Formulário
   */
  private async handleApplicationForm(page: Page, job?: Job) {
    const fullName = process.env.USER_FULL_NAME || 'EDIG Leonardo';
    const email = process.env.USER_EMAIL || 'ediigmelchiior@gmail.com';
    const phone = process.env.USER_PHONE || '+351960211775';

    // Preencher campos com esperas explícitas
    await page.fill('#nome, input[name*="nome"]', fullName);
    if (job) await job.updateProgress(40);
    
    await page.fill('#email, input[name*="email"]', email);
    if (job) await job.updateProgress(50);
    
    await page.fill('#telefone, input[name*="telefone"]', phone);
    if (job) await job.updateProgress(60);

    // Checkbox Termos (SPEC 3: Fallback JS)
    const termsLabel = page.locator('label:has-text("Li e aceito"), label:has-text("Termos e Condições")').first();
    const termsInput = page.locator('input[type="checkbox"]').first();

    try {
      if (await termsLabel.isVisible()) {
        await termsLabel.click({ force: true });
      } else {
        await page.evaluate(() => {
          const cb = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
          if (cb) { cb.click(); cb.checked = true; }
        });
      }
    } catch (e) {
      console.warn('[Sapo] Erro ao clicar no checkbox, tentando via check()...');
      await termsInput.check({ force: true }).catch(() => {});
    }

    if (job) await job.updateProgress(80);

    // Validação Final antes de submeter
    const isReady = await page.evaluate(() => {
      const n = (document.querySelector('#nome, input[name*="nome"]') as HTMLInputElement)?.value;
      const e = (document.querySelector('#email, input[name*="email"]') as HTMLInputElement)?.value;
      return n && e;
    });

    if (!isReady) {
      throw new Error('Campos obrigatórios não preenchidos após tentativa.');
    }
  }

  private async logFailure(page: Page, title: string, company: string, status: string) {
    await this.prisma.jobApplication.upsert({
      where: { jobId: page.url() },
      update: { status, updatedAt: new Date() },
      create: {
        jobId: page.url(),
        platform: 'SapoEmprego',
        title,
        company,
        status
      }
    });
  }

  async goToNextPage(page: Page): Promise<boolean> {
    const nextBtn = page.locator('a:has-text("Próximo"), .pagination .next a').first();
    if (await nextBtn.isVisible()) {
      await nextBtn.click();
      await page.waitForSelector('article h3 a', { timeout: 15000 }).catch(() => { });
      return true;
    }
    return false;
  }

  /**
   * Utilitários Resilientes
   */
  async handlePopups(page: Page) {
    const selectors = [
      '#qc-cmp2-ui button[mode="primary"]',
      '.ink-button.close-highimpact',
      '#fechar-x',
      'button:has-text("FECHAR")'
    ];
    
    // Processar todos os popups em paralelo para ganhar tempo
    await Promise.all(selectors.map(async (s) => {
      try {
        const btn = page.locator(s).first();
        if (await btn.isVisible()) {
          await btn.click({ timeout: 1000 }).catch(() => {});
        }
      } catch (e) {}
    }));
  }

  private async waitForCaptcha(page: Page) {
    await page.waitForFunction(() => {
      const res = (document.getElementsByName('h-captcha-response')[0] as HTMLTextAreaElement);
      return res && res.value !== '';
    }, { timeout: 120000 }).catch(() => {
      console.log('[Sapo] Timeout aguardando resolução de Captcha.');
    });
  }

  /**
   * Implementação da Interface JobBoardAdapter (Compatibilidade)
   */
  async scrapeJobs(page: Page, keywords: string, location: string): Promise<ScrapedJob[]> {
    return []; // Novo fluxo usa getJobUrls diretamente
  }

  async applyToJob(page: Page, jobId: string, aiSummary: string, job?: Job): Promise<boolean> {
    return this.applyToJobSpec(page, job);
  }
}
