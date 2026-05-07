import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { LinkedInAdapter } from './adapters/LinkedInAdapter';
import { SapoAdapter } from './adapters/SapoAdapter';
import { SearchAutomationService } from './services/SearchAutomationService';
import { SapoWorkflowService } from './services/SapoWorkflowService';
import { IntelligenceService } from './services/IntelligenceService';
import { WorkflowWorker } from './workers/WorkflowWorker';
import { NavigationEngine } from './services/NavigationEngine';
import { NotificationService } from './services/NotificationService';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [],
  providers: [
    LinkedInAdapter, 
    SapoAdapter, 
    SapoWorkflowService,
    SearchAutomationService,
    IntelligenceService,
    WorkflowWorker,
    NavigationEngine,
    NotificationService,
  ],
})
export class AppModule {}
