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
    // Anti-Ads (SPEC 2)
    await this.setupAntiAds(page);

    // 0. Autenticação (Novo Passo SPEC)
    await this.ensureAuthenticated(page, job);

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

    // Verificação de Domínio (SPEC 4)
    try {
      await page.waitForSelector('.main-content, #content, body', { timeout: 5000 });
      if (!page.url().includes('sapo.pt')) throw new Error('Fora do domínio SAPO');
    } catch (e) {
      console.warn('[Sapo] Estado "Perdido" detectado. Resetando para URL primária.');
      await page.goto('https://emprego.sapo.pt/');
      return false; 
    }

    // Aguardar o formulário aparecer (basta o seletor crítico)
    await page.waitForSelector('#nome, input[name*="nome"]', { timeout: 10000 })
      .catch(() => console.log('[Sapo] Aviso: Formulário não detetado imediatamente.'));

    // Extrair metadados para persistência
    const title = await page.locator('h1').first().innerText().catch(() => 'Vaga Sapo');
    const company = await page.locator('.company-name').first().innerText().catch(() => 'Empresa Sapo');

    try {
      // 1. SELEÇÃO DE CV (SPEC 1.3.4 - NOVO)
      const selectionSuccess = await this.selectCVFromDropdown(page, job);
      if (!selectionSuccess) {
        await this.logFailure(page, title, company, 'CV_Selection_Error');
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
   * SPEC 0: Autenticação Persistente
   */
  async ensureAuthenticated(page: Page, job?: Job) {
    console.log('[Sapo][Auth] Verificando sessão...');
    await page.goto('https://emprego.sapo.pt/', { waitUntil: 'domcontentloaded' });
    
    const isLogged = await page.locator('a:has-text("Sair"), .user-profile').count() > 0;
    if (isLogged) {
      console.log('[Sapo][Auth] Sessão ativa.');
      return;
    }

    console.log('[Sapo][Auth] Iniciando login...');
    if (job) await job.log('Autenticando no SAPO...');

    await page.goto('https://login.sapo.pt/LoginWithToken.do?to=https%3A%2F%2Femprego.sapo.pt%2F', { waitUntil: 'networkidle' });

    await page.fill('input#username, input[name="username"], input[type="email"]', process.env.SAPO_AUTH_EMAIL || '');
    await page.click('button:has-text("Continuar"), #submit-btn');
    
    await page.fill('input#password, input[name="password"], input[type="password"]', process.env.SAPO_AUTH_PASSWORD || '');
    await page.click('button:has-text("Continuar"), #submit-btn');

    await page.waitForLoadState('networkidle');
    
    const success = await page.locator('a:has-text("Sair"), .user-profile').count() > 0;
    if (!success) {
      throw new Error('Falha na autenticação SAPO. Verifique as credenciais no .env.');
    }
  }

  /**
   * SPEC 2: Anti-Ads Global Handler
   */
  async setupAntiAds(page: Page) {
    const closeSelectors = [
      'button:has-text("Fechar")',
      'button:has-text("FECHAR")',
      'button:has-text("x")',
      '.ink-button.close-highimpact',
      '#qc-cmp2-ui button[mode="primary"]', // Cookies como popup
      '#fechar-x'
    ];

    for (const selector of closeSelectors) {
      await page.addLocatorHandler(page.locator(selector).first(), async () => {
        console.log(`[Sapo][Anti-Ads] Fechando popup detectado: ${selector}`);
        await page.locator(selector).first().click().catch(() => {});
      });
    }
  }

  /**
   * SPEC 1.3.4: Seleção de CV via Dropdown (Estabilidade e Retry)
   */
  private async selectCVFromDropdown(page: Page, job?: Job): Promise<boolean> {
    const cvName = 'edig_it_2026';
    console.log(`[Sapo][CV] Selecionando CV: ${cvName}`);
    
    // Tentar 2 vezes com timeout de 10s (SPEC 2)
    for (let i = 0; i < 2; i++) {
      try {
        const dropdown = page.locator('select[name*="cv"], select[id*="cv"], .cv-dropdown').first();
        
        // Aguardar estabilidade (SPEC 3)
        await dropdown.waitFor({ state: 'visible', timeout: 10000 });
        await dropdown.scrollIntoViewIfNeeded();

        // Selecionar por texto ou valor
        await dropdown.selectOption({ label: cvName }).catch(async () => {
          await dropdown.selectOption({ value: cvName });
        });

        if (job) await job.updateProgress(25);
        return true;
      } catch (error) {
        console.warn(`[Sapo][CV] Tentativa ${i + 1} falhou. Retrying...`);
        if (i === 1) return false;
        await page.waitForTimeout(2000);
      }
    }
    return false;
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
          const inputs = document.querySelectorAll('input[type="checkbox"]');
          inputs.forEach(cb => { (cb as HTMLInputElement).click(); (cb as HTMLInputElement).checked = true; });
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
