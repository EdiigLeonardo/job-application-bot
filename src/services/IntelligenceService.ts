import { Injectable } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Page } from 'playwright';
import * as dotenv from 'dotenv';

dotenv.config();

@Injectable()
export class IntelligenceService {
  private genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
  private model = this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  private selectorCache: Record<string, string> = {};

  /**
   * Avalia a vaga e atribui uma nota de match e justificativa.
   */
  async evaluateJobMatch(jobDescription: string, userProfile: string) {
    const prompt = `
      Você é um recrutador técnico especialista.
      Avalie o "match" entre esta vaga de emprego e o perfil do candidato abaixo.
      
      Vaga: ${jobDescription}
      
      Perfil Candidate: ${userProfile}
      
      Responda estritamente em JSON no seguinte formato:
      {
        "score": (número de 0 a 100),
        "reason": (uma frase curta explicando a pontuação)
      }
    `;

    try {
      const result = await this.model.generateContent(prompt);
      const text = result.response.text();
      // Limpeza básica caso o modelo coloque markdown
      const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(jsonStr);
    } catch (e) {
      console.error('[Intelligence] Erro ao avaliar vaga:', e);
      return { score: 50, reason: 'Erro na avaliação da IA, assumindo neutro.' };
    }
  }

  /**
   * Tenta encontrar um seletor para um elemento baseado na descrição visual/DOM da página.
   * Usado para Self-Healing quando o seletor padrão falha.
   */
  async discoverSelector(page: Page, description: string): Promise<string | null> {
    if (this.selectorCache[description]) {
      console.log(`[Intelligence] Usando seletor do cache para: "${description}"`);
      return this.selectorCache[description];
    }

    console.log(`[Intelligence] Tentando descobrir seletor para: "${description}"...`);
    
    // Captura o HTML essencial da página (apenas tags que podem ser interativas)
    const domSummary = await page.evaluate(() => {
      const elements = document.querySelectorAll('button, input, a, [role="button"]');
      return Array.from(elements).map(el => {
        return {
          tag: el.tagName,
          text: (el as HTMLElement).innerText?.slice(0, 50),
          placeholder: (el as HTMLInputElement).placeholder,
          name: (el as HTMLInputElement).name,
          id: el.id,
          classes: el.className,
          type: (el as HTMLInputElement).type
        };
      }).slice(0, 50);
    });

    const prompt = `
      Considere o seguinte resumo dos elementos interativos de uma página web:
      ${JSON.stringify(domSummary)}
      
      Estou tentando encontrar o elemento que corresponde a: "${description}".
      Identifique qual o melhor seletor CSS único para este elemento baseado no resumo acima.
      
      Responda APENAS o seletor CSS (ex: "input[name='pesquisa']" ou "#btn-entrar").
      Se não tiver certeza, responda "null".
    `;

    try {
      const result = await this.model.generateContent(prompt);
      const selector = result.response.text().trim().replace(/['"`]/g, '');
      if (selector && selector !== 'null') {
        this.selectorCache[description] = selector;
        return selector;
      }
      return null;
    } catch (e: any) {
      if (e.status === 429) {
          console.error('[Intelligence] Quota excedida (429). Aguardando...');
          // Poderia implementar um delay aqui, mas por agora retornamos null para o retry do workflow lidar
      }
      console.error('[Intelligence] Erro ao descobrir seletor:', e);
      return null;
    }
  }
}
