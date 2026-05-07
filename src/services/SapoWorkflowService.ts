import { Injectable } from '@nestjs/common';
import { SapoAdapter } from '../adapters/SapoAdapter';
import { NavigationEngine } from './NavigationEngine';
import { chromium } from 'playwright';
import { Job } from 'bullmq';
import * as dotenv from 'dotenv';

dotenv.config();

@Injectable()
export class SapoWorkflowService {
  constructor(
    private sapoAdapter: SapoAdapter,
    private engine: NavigationEngine
  ) { }

  async runWorkflow(keyword: string, job?: Job) {
    console.log(`[SapoWorkflow] Processando keyword única: "${keyword}" via Worker.`);
    
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();
    
    // Timeout de Navegação conforme SPEC
    page.setDefaultNavigationTimeout(30000);

    try {
      await this.engine.processKeyword(context, page, keyword, [], job);
    } finally {
      await browser.close();
    }
  }
}
