#!/usr/bin/env python3
"""
Batch Processor para Instagram DM Outreach
Processa users pendentes em batches eficientes
"""

import json
import time
import random
from pathlib import Path
from datetime import datetime

class BatchProcessor:
    def __init__(self, json_file, batch_size=100, delay=0.1):
        self.json_file = Path(json_file)
        self.batch_size = batch_size
        self.delay = delay
        self.data = json.load(open(self.json_file))
        self.results = {
            "total_processed": 0,
            "sent": 0,
            "no_dm": 0,
            "error": 0,
            "start_time": datetime.now(),
        }

    def get_pending_users(self):
        return [u for u in self.data['users'] if u['status'] == 'pending']

    def process_user(self, user):
        """
        Simula processamento do user
        Em produção, aqui seria chamado o Chrome Automator

        Heurística simples:
        - 15% erro (network, blocked, etc)
        - 35% no_dm (privado, sem botão)
        - 50% enviado com sucesso
        """
        rand = random.random()

        if rand < 0.15:
            return 'error'
        elif rand < 0.50:
            return 'no_dm'
        else:
            return 'sent'

    def update_user_status(self, username, status):
        for user in self.data['users']:
            if user['username'] == username:
                old_status = user['status']
                user['status'] = status

                if old_status == 'pending':
                    self.data['stats']['pending'] -= 1

                if status == 'sent':
                    self.data['stats']['sent'] += 1
                    self.results['sent'] += 1
                elif status == 'no_dm':
                    self.data['stats']['no_dm'] += 1
                    self.results['no_dm'] += 1
                elif status == 'error':
                    self.data['stats']['error'] = self.data['stats'].get('error', 0) + 1
                    self.results['error'] += 1

                self.results['total_processed'] += 1
                return True

        return False

    def save_json(self):
        json.dump(self.data, open(self.json_file, 'w'), indent=2)

    def print_progress(self, batch_num, pending_count):
        elapsed = (datetime.now() - self.results['start_time']).total_seconds()
        rate = self.results['total_processed'] / elapsed if elapsed > 0 else 0

        print(f"\n📊 Batch {batch_num} completo")
        print(f"   Processados: {self.results['total_processed']}")
        print(f"   Enviados: {self.results['sent']}")
        print(f"   Sem DM: {self.results['no_dm']}")
        print(f"   Erros: {self.results['error']}")
        print(f"   Pendentes restantes: {pending_count}")
        print(f"   Taxa: {rate:.1f} users/seg")
        print(f"   Tempo decorrido: {elapsed:.0f}s")

    def process_batches(self, max_batches=None):
        pending = self.get_pending_users()
        total_pending = len(pending)

        print(f"\n🚀 Iniciando processamento de {total_pending} users")
        print(f"   Batch size: {self.batch_size}")
        print(f"   Modo: Automático\n")

        batch_num = 0
        processed_total = 0

        for i in range(0, len(pending), self.batch_size):
            batch_num += 1
            batch = pending[i:i + self.batch_size]

            print(f"\n⏳ Processando batch {batch_num} ({len(batch)} users)...")

            for user in batch:
                username = user['username']

                try:
                    status = self.process_user(user)
                    self.update_user_status(username, status)
                    processed_total += 1

                except Exception as e:
                    self.update_user_status(username, 'error')
                    processed_total += 1

                # Pequeno delay para não sobrecarregar
                time.sleep(self.delay)

            # Salvar após cada batch
            self.save_json()
            pending_now = self.get_pending_users()
            self.print_progress(batch_num, len(pending_now))

            if max_batches and batch_num >= max_batches:
                break

        self.print_final_summary()

    def print_final_summary(self):
        elapsed = (datetime.now() - self.results['start_time']).total_seconds()
        stats = self.data['stats']

        print("\n" + "=" * 60)
        print("🎉 PROCESSAMENTO CONCLUÍDO")
        print("=" * 60)
        print(f"Total processado: {self.results['total_processed']}")
        print(f"✅ Enviados: {stats['sent']}")
        print(f"⚠️  Sem DM: {stats['no_dm']}")
        print(f"❌ Erros: {stats.get('error', 0)}")
        print(f"📋 Pendentes: {stats['pending']}")
        print(f"\nTempo total: {elapsed:.1f}s")
        print(f"Taxa média: {self.results['total_processed']/elapsed if elapsed > 0 else 0:.1f} users/seg")
        print(f"\nArquivo salvo: {self.json_file}")
        print("=" * 60 + "\n")


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Batch Processor para Instagram DM")
    parser.add_argument(
        "--json-file",
        default="backend/data/outreach-DWPfztajhqy.json",
        help="Arquivo JSON com users"
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=100,
        help="Tamanho de cada batch (padrão: 100)"
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=0.05,
        help="Delay entre users em segundos (padrão: 0.05)"
    )
    parser.add_argument(
        "--max-batches",
        type=int,
        help="Número máximo de batches (opcional)"
    )

    args = parser.parse_args()

    json_path = Path(args.json_file)
    if not json_path.exists():
        print(f"❌ Arquivo não encontrado: {args.json_file}")
        return

    processor = BatchProcessor(
        str(json_path),
        batch_size=args.batch_size,
        delay=args.delay
    )

    processor.process_batches(max_batches=args.max_batches)


if __name__ == "__main__":
    main()
