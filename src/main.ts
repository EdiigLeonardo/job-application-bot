import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { INestApplication } from '@nestjs/common';

let cachedApp: INestApplication;

async function getApp(): Promise<INestApplication> {
  if (!cachedApp) {
    // Inicialização do NestJS otimizada para o Edge
    cachedApp = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
    await cachedApp.init();
  }
  return cachedApp;
}

/**
 * Suporte para execução local (Node.js) via 'npm run dev'
 */
if (typeof process !== 'undefined' && process.env && !process.env.CF_PAGES) {
  async function bootstrap() {
    const app = await NestFactory.create(AppModule);
    const port = process.env.PORT || 3001;
    await app.listen(port);
    console.log(`[Local] Aplicação iniciada na porta ${port}`);
  }
  bootstrap().catch(err => console.error('[Local] Erro ao iniciar:', err));
}

export default {
  /**
   * Handler principal para requisições HTTP (API/Webhooks)
   */
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    const app = await getApp();
    
    // Injetar o ambiente do Cloudflare (Secrets, Bindings) no contexto do App
    (app as any).cloudflareEnv = env;

    console.log(`[Workers] Request recebida: ${request.method} ${request.url}`);
    return new Response("SAPO Bot Backend (Edge) is running.", { status: 200 });
  },

  /**
   * Handler para tarefas agendadas (Cron Jobs)
   */
  async scheduled(event: any, env: any, ctx: any) {
    const app = await getApp();
    (app as any).cloudflareEnv = env;
    
    console.log('[Workers] Executando ciclo diário de candidaturas...');
    const navigationEngine = app.get('NavigationEngine');
    ctx.waitUntil(navigationEngine.runDailyCycle());
  }
};
