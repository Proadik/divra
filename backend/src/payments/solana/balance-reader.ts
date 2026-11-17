import { Inject, Injectable } from '@nestjs/common';
import { address, createSolanaRpc } from '@solana/kit';
import { APP_CONFIG, type AppConfig } from '../../config/config.js';

/** Баланс токена у владельца. Абстракция — тесты в сеть не ходят. */
export abstract class BalanceReader {
  /** Минимальные единицы токена mint во всех токен-аккаунтах owner */
  abstract balanceOf(owner: string, mint: string): Promise<bigint>;
}

interface ParsedTokenAccount {
  account: {
    data: { parsed: { info: { tokenAmount: { amount: string } } } };
  };
}

@Injectable()
export class RpcBalanceReader extends BalanceReader {
  private readonly rpc;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super();
    this.rpc = createSolanaRpc(config.SOLANA_RPC);
  }

  async balanceOf(owner: string, mint: string): Promise<bigint> {
    const { value } = await this.rpc
      .getTokenAccountsByOwner(
        address(owner),
        { mint: address(mint) },
        { encoding: 'jsonParsed', commitment: 'confirmed' },
      )
      .send({ abortSignal: AbortSignal.timeout(5_000) });
    return (value as unknown as ParsedTokenAccount[]).reduce(
      (sum, item) =>
        sum + BigInt(item.account.data.parsed.info.tokenAmount.amount),
      0n,
    );
  }
}
