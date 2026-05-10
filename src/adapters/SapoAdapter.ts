import { Injectable } from '@nestjs/common';
import { Page } from 'playwright';
import { JobBoardAdapter, ScrapedJob } from '../interfaces/JobBoardAdapter';
import { IntelligenceService } from '../services/IntelligenceService';
import { Job } from 'bullmq';
import * as dotenv from 'dotenv';
import { createPrismaClient } from '../database/prisma';

dotenv.config();

@Injectable()
export class SapoAdapter implements JobBoardAdapter {
  public readonly platform = 'SapoEmprego';
  private prisma = createPrismaClient(process.env.DATABASE_URL || '');

  constructor(private intelligence: IntelligenceService) { }

  /**
   * ENTRY_POINT: Decide entre Navegação Inicial (1.1) ou Processamento Direto (1.2).
   */
  async entryPoint(page: Page, keyword: string, job?: Job) {
    await this.setupAntiAds(page);
    await this.ensureAuthenticated(page, job);

    const url = page.url();
    if (url.includes('pesquisa=') && (url.includes('local=') || url.includes('search-results'))) {
      return;
    }

    await this.step11InitialNavigation(page, keyword, job);
  }

  /**
   * 1.1 (Navegação Inicial)
   */
  async step11InitialNavigation(page: Page, keyword: string, job?: Job) {
    console.log('[Sapo][SapoAdapter][step11InitialNavigation] Step 1.1: Navegação inicial...');
    await page.goto('https://emprego.sapo.pt/', { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Saneamento de DOM (SPEC 2)
    await page.addStyleTag({ content: '#sapoHighImpact, .qc-cmp2-container, #sapo-high-impact { display: none !important; }' });

    await page.waitForSelector('#qc-cmp2-ui button[mode="primary"]', { timeout: 2000 }).then(async (el) => {
      await el.click();
    }).catch(() => {});

    await this.handlePopups(page);

    await page.evaluate((kw) => {
      const input = document.querySelector('input#search') as HTMLInputElement;
      if (input) {
        input.value = kw;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, keyword);

    // Dropdown: Selecionar "Lisboa" (SPEC 2: Force Bypass + JS Fallback)
    await page.click('button.ink-button:has-text("Distrito"), button.ink-button:has-text("Lisboa")');
    try {
      await page.locator('label[for="dest11"]').click({ force: true, timeout: 5000 });
    } catch (e) {
      await page.evaluate(() => (document.querySelector('label[for="dest11"]') as HTMLElement)?.click());
    }

    await Promise.race([
      page.click('button.ink-button.main-action:has-text("PROCURAR")'),
      page.waitForSelector('.ink-button.close-highimpact', { timeout: 10000 }).then(el => el.click())
    ]).catch(() => { });

    await page.waitForSelector('article h3 a', { timeout: 30000 }).catch(() => {});
  }

  async getJobUrls(page: Page): Promise<string[]> {
    await this.handlePopups(page);
    const links = await page.$$eval('article h3 a', (els) =>
      els.map(el => (el as HTMLAnchorElement).href)
    );
    return links;
  }

  async applyToJobSpec(page: Page, job?: Job, keyword?: string): Promise<boolean> {
    await this.handlePopups(page);

    const applyButton = page.locator('text=/CANDIDATE-SE/i').first();
    await applyButton.waitFor({ state: 'visible', timeout: 10000 }).catch(() => { });

    if (!(await applyButton.isVisible())) {
      if (!(await page.locator('#nome').isVisible())) return false;
    } else {
      await applyButton.scrollIntoViewIfNeeded();
      await applyButton.click({ force: true });
    }

    // SPEC 1: Verificação Condicional (Mid-Flight Auth)
    try {
      const loginRequired = page.locator('text=/Login ou Registe-se já/i').first();
      if (await loginRequired.isVisible({ timeout: 2000 })) {
        console.log('[Auth] Login in-page detectado e acionado. Forçando refresh de sessão...');
        await loginRequired.click();
        await page.waitForLoadState('networkidle');
        
        const formVisible = await page.locator('#nome, input[name*="nome"]').isVisible({ timeout: 5000 });
        if (!formVisible) {
          console.warn('[Auth] Formulário ainda indisponível após clique in-page. Tentando reload...');
          await page.reload();
        }
      }
    } catch (e) { }

    // Verificação de Domínio (SPEC 4 & Domain Anchor)
    try {
      const currentUrl = page.url();
      if (currentUrl.includes('login.sapo.pt')) {
        console.warn('[Sapo] Redirecionamento inesperado para Login detectado.');
        return false;
      }
      await page.waitForSelector('.main-content, #content, body', { timeout: 5000 });
      if (!currentUrl.includes('sapo.pt')) throw new Error('Fora do domínio SAPO');
    } catch (e) {
      await page.goto('https://emprego.sapo.pt/');
      return false; 
    }

    const title = await page.locator('h1').first().innerText().catch(() => 'Vaga Sapo');
    const company = await page.locator('.company-name').first().innerText().catch(() => 'Empresa Sapo');

    try {
      if (!(await this.selectCVFromDropdown(page, job))) return false;
      await this.handleApplicationForm(page, job);

      await page.click('button:has-text("ENVIAR CANDIDATURA")');

      const successIndicator = page.locator('text=/sucesso/i, .success, .alert-success').first();
      try {
        await successIndicator.waitFor({ state: 'visible', timeout: 15000 });
      } catch (e) {
        const errorText = await page.locator('.error, .alert-danger').innerText().catch(() => '');
        if (errorText.toLowerCase().includes('captcha')) {
          await this.waitForCaptcha(page);
          await page.click('button:has-text("ENVIAR CANDIDATURA")');
          await successIndicator.waitFor({ state: 'visible', timeout: 15000 });
        } else {
          throw new Error(errorText);
        }
      }

      await this.prisma.jobApplication.upsert({
        where: { jobId: page.url() },
        update: { status: 'APPLIED', updatedAt: new Date(), keyword },
        create: {
          jobId: page.url(),
          platform: 'SapoEmprego',
          title,
          company,
          status: 'APPLIED',
          keyword
        }
      });

      return true;
    } catch (error) {
      return false;
    }
  }

  async ensureAuthenticated(page: Page, job?: Job, forceReset = false) {
    if (forceReset) {
      await page.context().clearCookies();
    }

    const isLogged = await page.locator('a:has-text("Sair"), .user-profile').count() > 0;
    if (isLogged) return;

    await page.goto('https://login.sapo.pt/LoginWithToken.do?to=https%3A%2F%2Femprego.sapo.pt%2F', { waitUntil: 'networkidle' });

    await page.fill('input#username, input[type="email"]', process.env.SAPO_AUTH_EMAIL || '');
    await page.click('button:has-text("Continuar"), #submit-btn');
    
    await page.fill('input#password, input[type="password"]', process.env.SAPO_AUTH_PASSWORD || '');
    await page.click('button:has-text("Continuar"), #submit-btn');

    await page.waitForLoadState('networkidle');
  }

  async setupAntiAds(page: Page) {
    const closeSelectors = ['button:has-text("Fechar")', '.ink-button.close-highimpact', '#fechar-x'];
    for (const selector of closeSelectors) {
      await page.addLocatorHandler(page.locator(selector).first(), async () => {
        await page.locator(selector).first().click().catch(() => {});
      });
    }
  }

  private async selectCVFromDropdown(page: Page, job?: Job): Promise<boolean> {
    const cvName = 'edig_it_2026';
    const dropdown = page.locator('select[name*="cv"], select[id*="cv"]').first();
    try {
      await dropdown.waitFor({ state: 'visible', timeout: 10000 });
      await dropdown.selectOption({ label: cvName }).catch(() => dropdown.selectOption({ value: cvName }));
      return true;
    } catch (e) {
      return false;
    }
  }

  private async handleApplicationForm(page: Page, job?: Job) {
    await page.fill('#nome, input[name*="nome"]', process.env.USER_FULL_NAME || 'EDIG Leonardo');
    await page.fill('#email, input[name*="email"]', process.env.USER_EMAIL || 'ediigmelchiior@gmail.com');
    await page.fill('#telefone, input[name*="telefone"]', process.env.USER_PHONE || '+351960211775');

    const termsLabel = page.locator('label:has-text("Li e aceito")').first();
    if (await termsLabel.isVisible()) await termsLabel.click({ force: true });
    else await page.evaluate(() => (document.querySelector('input[type="checkbox"]') as any)?.click());
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

  async handlePopups(page: Page) {
    const selectors = ['#qc-cmp2-ui button[mode="primary"]', '.ink-button.close-highimpact', '#fechar-x'];
    for (const s of selectors) {
      try {
        const btn = page.locator(s).first();
        if (await btn.isVisible()) await btn.click({ timeout: 1000 }).catch(() => {});
      } catch (e) {}
    }
  }

  private async waitForCaptcha(page: Page) {
    await page.waitForFunction(() => {
      const res = (document.getElementsByName('h-captcha-response')[0] as any);
      return res && res.value !== '';
    }, { timeout: 120000 }).catch(() => {});
  }

  async scrapeJobs(page: Page, keywords: string, location: string): Promise<ScrapedJob[]> { return []; }
  async applyToJob(page: Page, jobId: string, aiSummary: string, job?: Job): Promise<boolean> { return this.applyToJobSpec(page, job); }
}
