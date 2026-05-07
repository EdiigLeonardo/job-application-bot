import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import { SapoWorkflowService } from '../services/SapoWorkflowService';
import { 
  redisConnection, 
  WORKFLOW_QUEUE_NAME 
} from '../services/QueueConfig';

@Injectable()
export class WorkflowWorker implements OnModuleInit, OnModuleDestroy {
  private worker!: Worker;

  constructor(private sapoWorkflow: SapoWorkflowService) {}

  async onModuleInit() {
    console.log('[WorkflowWorker] Iniciando worker sequencial (concurrency: 1)...');
    
    this.worker = new Worker(
      WORKFLOW_QUEUE_NAME,
      async (job: Job) => {
        const { keyword } = job.data;
        console.log(`[WorkflowWorker] Iniciando processamento para keyword: ${keyword}`);
        
        try {
          await job.log(`Iniciando processamento para: ${keyword}`);
          await this.sapoWorkflow.runWorkflow(keyword, job);
          console.log(`[WorkflowWorker] Finalizado com sucesso: ${keyword}`);
        } catch (error: any) {
          console.error(`[WorkflowWorker] Erro crítico no workflow para ${keyword}: ${error.message}`);
          await job.log(`Erro crítico: ${error.message}`);
          throw error;
        }
      },
      {
        connection: redisConnection,
        concurrency: 1,
        stalledInterval: 30000,
        lockDuration: 60000, // Aumenta o tempo de lock para operações longas
      }
    );

    this.worker.on('failed', (job, err) => {
      console.error(`[WorkflowWorker] Job ${job?.id} falhou: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    await this.worker.close();
  }
}
