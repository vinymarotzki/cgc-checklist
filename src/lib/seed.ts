import { getDb, initDb } from "./db";
import { v4 as uuidv4 } from "uuid";

const ACTIVITIES = [
  // 1. Planejamento e Articulação Institucional
  {
    category: "1. Planejamento e Articulação Institucional",
    activity: "Oficializar ao CBMMS solicitação de apoio para realização do simulado com emprego de viaturas.",
  },
  {
    category: "1. Planejamento e Articulação Institucional",
    activity: "Oficializar ao CIOPS solicitação de apoio para atendimento da ligação de emergência oriunda do simulado.",
  },
  {
    category: "1. Planejamento e Articulação Institucional",
    activity: "Informar ao COSI sobre a realização do simulado e o acionamento do alarme de incêndio.",
  },
  {
    category: "1. Planejamento e Articulação Institucional",
    activity: "Encaminhar Comunicado Interno à SED, convidando representantes para participação no evento, incluindo a Assessoria de Comunicação.",
  },
  {
    category: "1. Planejamento e Articulação Institucional",
    activity: "Encaminhar Comunicado Interno ao Gestor Escolar, orientando sobre a realização do simulado e divulgação à comunidade escolar.",
  },

  // 2. Organização Operacional
  {
    category: "2. Organização Operacional",
    activity: "Definir responsável pelo acionamento do alarme de incêndio.",
  },
  {
    category: "2. Organização Operacional",
    activity: "Definir responsável pelo acionamento do CBMMS.",
  },
  {
    category: "2. Organização Operacional",
    activity: "Definir responsável pela recepção das viaturas do CBMMS.",
  },
  {
    category: "2. Organização Operacional",
    activity: "Definir responsável pelas anotações e registro do simulado.",
  },
  {
    category: "2. Organização Operacional",
    activity: "Definir responsável geral pela coordenação do exercício.",
  },
  {
    category: "2. Organização Operacional",
    activity: "Realizar orientação prévia aos brigadistas.",
  },
  {
    category: "2. Organização Operacional",
    activity: "Designar 01 brigadista por setor para condução da evacuação.",
  },
  {
    category: "2. Organização Operacional",
    activity: "Orientar os monitores sobre suas atribuições durante o exercício.",
  },
  {
    category: "2. Organização Operacional",
    activity: "Realizar orientação prévia com o responsável pela sala especial (PCDs).",
  },

  // 3. Preparação da Infraestrutura
  {
    category: "3. Preparação da Infraestrutura",
    activity: "Testar o funcionamento do alarme de incêndio.",
  },
  {
    category: "3. Preparação da Infraestrutura",
    activity: "Testar o funcionamento da campainha da escola (plano alternativo de acionamento).",
  },
  {
    category: "3. Preparação da Infraestrutura",
    activity: "Solicitar aparelho de som para realização dos briefings, caso necessário.",
  },
  {
    category: "3. Preparação da Infraestrutura",
    activity: "Definir área de estacionamento das viaturas do CBMMS.",
  },
  {
    category: "3. Preparação da Infraestrutura",
    activity: "Verificar se o portão principal está acessível para as viaturas.",
  },
  {
    category: "3. Preparação da Infraestrutura",
    activity: "Confirmar acessibilidade dos portões da quadra (ponto de encontro).",
  },
  {
    category: "3. Preparação da Infraestrutura",
    activity: "Orientar a segurança patrimonial para permanecer no portão principal durante toda a atividade para controle do acesso de visitantes.",
  },
  {
    category: "3. Preparação da Infraestrutura",
    activity: "Confirmar local do ponto de encontro dos estudantes (preferencialmente a quadra de esportes).",
  },
  {
    category: "3. Preparação da Infraestrutura",
    activity: "Confirmar ponto de encontro para debriefing da CGC.",
  },

  // 4. Orientações Prévias
  {
    category: "4. Orientações Prévias (Dia do Evento)",
    activity: "08h00 às 08h15 – Realizar orientação a todos os servidores (sala dos professores): objetivos, evacuação, funções, rotas, pontos de encontro e procedimentos de segurança.",
  },
  {
    category: "4. Orientações Prévias (Dia do Evento)",
    activity: "09h30 às 09h40 – Realizar orientação aos estudantes no pátio: importância do simulado, comportamento esperado, rotas, ponto de encontro, proibição de corridas.",
  },

  // 5. Execução do Simulado - Prontidão
  {
    category: "5. Execução do Simulado – Prontidão (09h50)",
    activity: "Confirmar posicionamento dos brigadistas.",
  },
  {
    category: "5. Execução do Simulado – Prontidão (09h50)",
    activity: "Confirmar posicionamento dos monitores.",
  },
  {
    category: "5. Execução do Simulado – Prontidão (09h50)",
    activity: "Confirmar prontidão dos responsáveis pelas comunicações.",
  },

  // 5. Execução - 1º Alarme
  {
    category: "5. Execução do Simulado – 1º Alarme (10h00)",
    activity: "Acionar o primeiro alarme.",
  },
  {
    category: "5. Execução do Simulado – 1º Alarme (10h00)",
    activity: "Monitores permanecem próximos às respectivas salas sob sua responsabilidade.",
  },
  {
    category: "5. Execução do Simulado – 1º Alarme (10h00)",
    activity: "Brigadistas assumem posição de prontidão nos setores designados.",
  },

  // 5. Execução - 2º Alarme
  {
    category: "5. Execução do Simulado – 2º Alarme (10h03)",
    activity: "Acionar o segundo alarme.",
  },
  {
    category: "5. Execução do Simulado – 2º Alarme (10h03)",
    activity: "Iniciar evacuação das edificações.",
  },
  {
    category: "5. Execução do Simulado – 2º Alarme (10h03)",
    activity: "Empregar a Brigada de Incêndio na condução da evacuação.",
  },
  {
    category: "5. Execução do Simulado – 2º Alarme (10h03)",
    activity: "Monitores supervisionam o deslocamento dos estudantes.",
  },
  {
    category: "5. Execução do Simulado – 2º Alarme (10h03)",
    activity: "Confirmar esvaziamento de todas as salas e dependências.",
  },
  {
    category: "5. Execução do Simulado – 2º Alarme (10h03)",
    activity: "Realizar acionamento do CBMMS.",
  },
  {
    category: "5. Execução do Simulado – 2º Alarme (10h03)",
    activity: "Recepcionar as viaturas do CBMMS.",
  },

  // 5. Contingência
  {
    category: "5. Execução do Simulado – Contingência",
    activity: "Caso o alarme de incêndio não funcione, utilizar a campainha da escola para sinalização da evacuação.",
  },

  // 6. Encerramento
  {
    category: "6. Encerramento do Simulado",
    activity: "Confirmar se todos os ocupantes alcançaram o ponto de encontro.",
  },
  {
    category: "6. Encerramento do Simulado",
    activity: "Realizar conferência das turmas.",
  },
  {
    category: "6. Encerramento do Simulado",
    activity: "Encerrar a atividade operacional.",
  },
  {
    category: "6. Encerramento do Simulado",
    activity: 'No comando "SIMULADO ENCERRADO", os monitores conduzem os estudantes de volta às respectivas salas pelo caminho inverso.',
  },

  // 7. Debriefing
  {
    category: "7. Debriefing e Avaliação",
    activity: "Reunir a CGC em frente ao ponto pré-estabelecido.",
  },
  {
    category: "7. Debriefing e Avaliação",
    activity: "Apresentar observações dos brigadistas.",
  },
  {
    category: "7. Debriefing e Avaliação",
    activity: "Apresentar observações dos monitores.",
  },
  {
    category: "7. Debriefing e Avaliação",
    activity: "Registrar dificuldades encontradas.",
  },
  {
    category: "7. Debriefing e Avaliação",
    activity: "Registrar oportunidades de melhoria.",
  },
  {
    category: "7. Debriefing e Avaliação",
    activity: "Avaliar tempos de resposta e evacuação.",
  },
  {
    category: "7. Debriefing e Avaliação",
    activity: "Elaborar relatório do simulado por meio do aplicativo SASI durante o debriefing.",
  },
  {
    category: "7. Debriefing e Avaliação",
    activity: "Encaminhar cópia do relatório à gestão escolar.",
  },
];

async function seed() {
  await initDb();
  const db = getDb();

  const existing = await db.execute("SELECT COUNT(*) as count FROM activities");
  const count = (existing.rows[0] as unknown as { count: number }).count;

  if (count > 0) {
    console.log("Database already seeded. Skipping.");
    return;
  }

  for (const item of ACTIVITIES) {
    await db.execute({
      sql: "INSERT INTO activities (id, category, activity, status) VALUES (?, ?, ?, ?)",
      args: [uuidv4(), item.category, item.activity, "SEM_STATUS"],
    });
  }

  console.log(`Seeded ${ACTIVITIES.length} activities.`);
}

seed().catch(console.error);
