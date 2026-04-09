/**
 * Health Checker Service
 * Monitora o status de todos os componentes do sistema
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class HealthChecker {
  constructor() {
    this.checks = new Map();
    this.lastCheckTime = null;
    this.checkInterval = 30000; // 30 segundos
    this.statusCache = null;
  }

  /**
   * Verifica status do Claude Code SDK
   */
  async checkClaudeSDK() {
    try {
      // Verificar se o processo do Claude está rodando
      const { stdout } = await execAsync('ps aux | grep -i claude | grep -v grep | wc -l');
      const processCount = parseInt(stdout.trim());
      
      // Verificar limite da API
      const now = Math.floor(Date.now() / 1000);
      const resetTime = 1755644400; // Timestamp do reset conhecido
      const isLimitReached = now < resetTime;
      
      return {
        name: 'Claude Code SDK',
        status: processCount > 0 && !isLimitReached ? 'healthy' : 'unhealthy',
        processCount,
        isLimitReached,
        resetIn: isLimitReached ? resetTime - now : 0,
        resetTime: isLimitReached ? new Date(resetTime * 1000).toISOString() : null,
        message: isLimitReached ? 'API limit reached, waiting for reset' : 'SDK operational'
      };
    } catch (error) {
      return {
        name: 'Claude Code SDK',
        status: 'error',
        error: error.message
      };
    }
  }

  /**
   * Verifica Socket.IO
   */
  async checkSocketIO(io) {
    try {
      if (!io) {
        return {
          name: 'Socket.IO',
          status: 'unavailable',
          message: 'Socket.IO not initialized'
        };
      }

      const sockets = await io.fetchSockets();
      
      return {
        name: 'Socket.IO',
        status: 'healthy',
        connectedClients: sockets.length,
        message: `${sockets.length} clients connected`
      };
    } catch (error) {
      return {
        name: 'Socket.IO',
        status: 'error',
        error: error.message
      };
    }
  }

  /**
   * Verifica memória do sistema
   */
  async checkSystemMemory() {
    try {
      const memUsage = process.memoryUsage();
      const totalMemory = require('os').totalmem();
      const freeMemory = require('os').freemem();
      
      const usagePercent = ((totalMemory - freeMemory) / totalMemory) * 100;
      
      return {
        name: 'System Memory',
        status: usagePercent < 90 ? 'healthy' : 'warning',
        usage: {
          rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
          heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
          heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
          external: `${Math.round(memUsage.external / 1024 / 1024)}MB`
        },
        system: {
          total: `${Math.round(totalMemory / 1024 / 1024)}MB`,
          free: `${Math.round(freeMemory / 1024 / 1024)}MB`,
          usagePercent: usagePercent.toFixed(2)
        },
        message: usagePercent < 90 ? 'Memory usage normal' : 'High memory usage detected'
      };
    } catch (error) {
      return {
        name: 'System Memory',
        status: 'error',
        error: error.message
      };
    }
  }

  /**
   * Executa todos os health checks
   */
  async performFullCheck(dependencies = {}) {
    const {
      io
    } = dependencies;

    const checks = await Promise.all([
      this.checkClaudeSDK(),
      this.checkSocketIO(io),
      this.checkSystemMemory()
    ]);

    const overallStatus = this.calculateOverallStatus(checks);
    
    const result = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks: checks.reduce((acc, check) => {
        acc[check.name.toLowerCase().replace(/\s+/g, '_')] = check;
        return acc;
      }, {}),
      summary: {
        total: checks.length,
        healthy: checks.filter(c => c.status === 'healthy').length,
        unhealthy: checks.filter(c => c.status === 'unhealthy').length,
        errors: checks.filter(c => c.status === 'error').length,
        warnings: checks.filter(c => c.status === 'warning').length
      }
    };

    this.statusCache = result;
    this.lastCheckTime = Date.now();
    
    return result;
  }

  /**
   * Calcula status geral baseado nos checks individuais
   */
  calculateOverallStatus(checks) {
    const hasErrors = checks.some(c => c.status === 'error');
    const hasUnhealthy = checks.some(c => c.status === 'unhealthy');
    const hasWarnings = checks.some(c => c.status === 'warning');
    
    if (hasErrors || hasUnhealthy) return 'unhealthy';
    if (hasWarnings) return 'degraded';
    return 'healthy';
  }

  /**
   * Retorna status em cache se recente
   */
  getCachedStatus() {
    if (this.statusCache && this.lastCheckTime) {
      const age = Date.now() - this.lastCheckTime;
      if (age < this.checkInterval) {
        return {
          ...this.statusCache,
          cached: true,
          cacheAge: Math.round(age / 1000)
        };
      }
    }
    return null;
  }

  /**
   * Inicia monitoramento automático
   */
  startMonitoring(dependencies, interval = 30000) {
    this.checkInterval = interval;
    
    // Executa primeira verificação
    this.performFullCheck(dependencies);
    
    // Configura verificações periódicas
    setInterval(() => {
      this.performFullCheck(dependencies);
    }, interval);
    
    console.log(`🏥 Health monitoring started (interval: ${interval/1000}s)`);
  }
}

module.exports = HealthChecker;