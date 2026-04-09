// Sistema unificado de sessões — fonte única de verdade
class SessionContextManager {
  constructor() {
    this.sessions = new Map();

    // Limpar sessões antigas a cada hora
    this._cleanupTimer = setInterval(() => this.cleanOldSessions(), 3600000);
  }

  // Obter ou criar sessão
  getOrCreate(sessionId, title) {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        id: sessionId,
        messages: [],
        title: title || `Session ${sessionId.slice(0, 8)}...`,
        createdAt: Date.now(),
        lastActivity: Date.now()
      });
    }
    return this.sessions.get(sessionId);
  }

  // Obter sessão existente (ou null)
  get(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  // Adicionar mensagem ao contexto da sessão
  addMessage(sessionId, message) {
    const session = this.getOrCreate(sessionId);
    session.messages.push(message);
    session.lastActivity = Date.now();
    // Atualizar título com a primeira mensagem do usuário
    if (message.role === 'user' && session.messages.filter(m => m.role === 'user').length === 1) {
      session.title = message.content.length > 50
        ? message.content.substring(0, 50) + '...'
        : message.content;
    }
  }

  // Obter contexto formatado para enviar ao Claude (últimas 10 mensagens)
  getFormattedContext(sessionId, currentMessage) {
    const session = this.sessions.get(sessionId);

    if (!session || session.messages.length === 0) {
      return currentMessage;
    }

    const recentMessages = session.messages.slice(-10);

    let contextPrompt = "Contexto da conversa anterior:\n";
    recentMessages.forEach(msg => {
      const role = msg.role === 'user' ? 'Usuário' : 'Assistente';
      contextPrompt += `\n${role}: ${msg.content}`;
    });

    contextPrompt += `\n\n---\nNova mensagem do usuário: ${currentMessage}`;
    contextPrompt += `\n\nIMPORTANTE: Use o contexto acima para responder de forma coerente e lembrando das informações anteriores da conversa.`;

    return contextPrompt;
  }

  // Listar todas as sessões (para endpoint REST)
  listSessions() {
    return Array.from(this.sessions.entries()).map(([id, data]) => ({
      id,
      created: data.createdAt,
      lastActivity: data.lastActivity,
      messageCount: data.messages.length,
      title: data.title
    }));
  }

  // Deletar sessão
  delete(sessionId) {
    return this.sessions.delete(sessionId);
  }

  // Limpar sessões antigas (sem atividade por 4 horas)
  cleanOldSessions() {
    const fourHoursAgo = Date.now() - (4 * 60 * 60 * 1000);
    let cleaned = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.lastActivity < fourHoursAgo) {
        this.sessions.delete(sessionId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`🧹 Cleaned ${cleaned} old sessions`);
    }
  }

  // Obter estatísticas
  getStats() {
    const stats = {
      totalSessions: this.sessions.size,
      totalMessages: 0,
      averageMessagesPerSession: 0
    };

    for (const session of this.sessions.values()) {
      stats.totalMessages += session.messages.length;
    }

    if (stats.totalSessions > 0) {
      stats.averageMessagesPerSession = Math.round(stats.totalMessages / stats.totalSessions);
    }

    return stats;
  }

  // Cleanup para graceful shutdown
  destroy() {
    clearInterval(this._cleanupTimer);
  }
}

module.exports = SessionContextManager;
