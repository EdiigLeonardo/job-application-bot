import { Injectable } from '@nestjs/common';

@Injectable()
export class NotificationService {
  /**
   * Envia o resumo diário de candidaturas conforme a SPEC.
   */
  async sendDailySummary(applications: any[]) {
    const today = new Date().toLocaleDateString('pt-PT');
    const total = applications.length;
    const recipient = 'ediigmelchiior@gmail.com';
    
    const subject = `Candidaturas de [${today}]`;
    let body = `Foram enviadas ${total} candidaturas hoje.\n\nLista detalhada:\n`;
    
    applications.forEach((app, index) => {
      body += `${index + 1}. ${app.title} - ${app.company} (${app.location})\n`;
    });

    console.log(`[NotificationService] Resumo gerado para ${recipient}. Total: ${total}`);
    
    // REFERÊNCIA À CHAMADA DE EMAIL GENÉRICA (Conforme Instrução Pragmática)
    // await this.genericEmailProvider.sendMail({
    //   to: recipient,
    //   subject: subject,
    //   text: body
    // });
  }
}
