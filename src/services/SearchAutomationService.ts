import { Injectable, OnModuleInit } from '@nestjs/common';
import { NavigationEngine } from './NavigationEngine';

@Injectable()
export class SearchAutomationService implements OnModuleInit {
  // Lista de keywords conforme SPEC
  private keywords = [
    'Frontend Developer', 'Backend Developer', 'Fullstack Developer', 'Software Engineer',
    'Senior Frontend Developer', 'Senior Backend Developer', 'Senior Fullstack Developer', 'Senior Software Engineer',
    'Mid Frontend Developer', 'Mid Backend Developer', 'Mid Fullstack Developer', 'Mid Software Engineer',
    'Junior Frontend Developer', 'Junior Backend Developer', 'Junior Fullstack Developer', 'Junior Software Engineer',
    'Javascript Developer', 'Node Developer', 'React Developer', 'Nest Developer', 'Python Developer',
    'Django Developer', 'Flask Developer', 'FastAPI Developer', 'Java Developer', 'Spring Developer',
    'PHP Developer', 'Laravel Developer', 'TypeScript Developer', 'SQL Developer', 'PostgreSQL Developer',
    'MySQL Developer', 'MongoDB Developer', 'Docker Developer', 'AWS Developer', 'Azure Developer',
    'GCP Developer', 'Next.js Developer', 'Angular Developer', 'Vue.js Developer', 'Express.js Developer',
    'NestJS Developer', 'FastAPI Developer', 'Django Developer', 'Flask Developer', 'Laravel Developer',
    'Spring Boot Developer', 'Javascript', 'Node', 'React', 'Nest', 'Python', 'Django', 'Flask', 'FastAPI', 'Java', 'Spring', 'PHP', 'Laravel', 'TypeScript', 'SQL', 'PostgreSQL', 'MySQL', 'MongoDB', 'Docker', 'AWS', 'Azure', 'GCP', 'Next.js', 'Angular', 'Vue.js', 'Express.js', 'NestJS', 'FastAPI', 'Django', 'Flask', 'Laravel', 'Spring Boot',
    'Frontend Developer', 'Backend Developer', 'Fullstack Developer', 'Software Engineer',
    'Senior Frontend Developer', 'Senior Backend Developer', 'Senior Fullstack Developer', 'Senior Software Engineer',
    'Mid Frontend Developer', 'Mid Backend Developer', 'Mid Fullstack Developer', 'Mid Software Engineer',
    'Junior Frontend Developer', 'Junior Backend Developer', 'Junior Fullstack Developer', 'Junior Software Engineer',
    'Javascript Developer', 'TypeScript Developer', 'MERN', 'PERN', 'MEAN', 'Node Developer', 'React Developer', 'Nest Developer', 'Python Developer',
    'Django Developer', 'Flask Developer', 'FastAPI Developer', 'Java Developer', 'Spring Developer',
    'PHP Developer', 'Laravel Developer', 'TypeScript Developer', 'SQL Developer', 'PostgreSQL Developer',
    'MySQL Developer', 'MongoDB Developer', 'Docker Developer', 'AWS Developer', 'Azure Developer',
    'GCP Developer', 'Next.js Developer', 'Angular Developer', 'Vue.js Developer', 'Express.js Developer',
    'NestJS Developer', 'FastAPI Developer', 'Django Developer', 'Flask Developer', 'Laravel Developer',
    'Spring Boot Developer', 'Javascript', 'Node', 'React', 'Nest', 'Python', 'Django', 'Flask', 'FastAPI', 'Java', 'Spring', 'PHP', 'Laravel', 'TypeScript', 'SQL', 'PostgreSQL', 'MySQL', 'MongoDB', 'Docker', 'AWS', 'Azure', 'GCP', 'Next.js', 'Angular', 'Vue.js', 'Express.js', 'NestJS', 'FastAPI', 'Django', 'Flask', 'Laravel', 'Spring Boot',
    'Frontend Developer', 'Backend Developer', 'Fullstack Developer', 'Software Engineer',
    'Senior Frontend Developer', 'Senior Backend Developer', 'Senior Fullstack Developer', 'Senior Software Engineer',
    'Mid Frontend Developer', 'Mid Backend Developer', 'Mid Fullstack Developer', 'Mid Software Engineer',
    'Junior Frontend Developer', 'Junior Backend Developer', 'Junior Fullstack Developer', 'Junior Software Engineer',
  ];

  constructor(private navigationEngine: NavigationEngine) { }

  async onModuleInit() {
    console.log('[Orchestrator] Inicializando Motor de Automação SPEC-Driven para Sapo Emprego...');
    this.startAutomation();
  }

  private async startAutomation() {
    try {
      await this.navigationEngine.runInfiniteLoop(this.keywords);
    } catch (error) {
      console.error('[Orchestrator] Erro fatal no motor de navegação:', error);
    }
  }
}
