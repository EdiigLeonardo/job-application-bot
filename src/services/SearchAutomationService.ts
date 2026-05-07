import { Injectable, OnModuleInit } from '@nestjs/common';
import { NavigationEngine } from './NavigationEngine';

@Injectable()
export class SearchAutomationService implements OnModuleInit {
  // Lista de keywords conforme SPEC
  private keywords = ['Javascript'];

  constructor(private navigationEngine: NavigationEngine) {}

  async onModuleInit() {
    console.log('[Orchestrator] Inicializando Motor de Automação SPEC-Driven para Sapo Emprego...');
    
    // Inicia o ciclo infinito (24h) conforme SPEC
    // Executado de forma assíncrona para permitir o startup completo do módulo
    this.startAutomation();
  }

  private async startAutomation() {
    try {
      await this.navigationEngine.runInfiniteLoop(this.keywords);
    } catch (error) {
      console.error('[Orchestrator] Erro fatal no motor de navegação:', error);
      // Em um cenário real, poderíamos implementar um retry aqui ou alertar
    }
  }
}
