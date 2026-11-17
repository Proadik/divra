import { randomBytes } from 'node:crypto';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { TokenService, type TokenPair } from '@nestjs/authentication';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { UsersRepository } from '../users/repositories/users.repository.js';
import type { AuthUser } from '../users/user.interface.js';
import type { ChallengeRequest, VerifyRequest } from './auth.schemas.js';
import {
  ChallengesRepository,
  MAX_PENDING_PER_ADDRESS,
} from './repositories/challenges.repository.js';
import { BlockhashSource } from './solana/blockhash.source.js';
import {
  buildChallengeTransaction,
  decodeSignedTransaction,
  matchesChallengeMessage,
  toAddress,
  verifyEd25519,
} from './solana/challenge-transaction.js';

export interface IssuedChallenge {
  chain: 'solana';
  challengeId: string;
  transaction: string;
  message: string;
  expiresAt: string;
}

export interface WalletSignIn {
  user: AuthUser & { chain: 'solana'; address: string; created: boolean };
  tokens: TokenPair;
}

/** Один ответ на любую ошибку проверки: не подсказываем, что именно не так */
const rejected = (): UnauthorizedException =>
  new UnauthorizedException(
    'Подпись не прошла проверку. Запроси новый вызов и подпиши его.',
  );

@Injectable()
export class WalletAuthService {
  private readonly logger = new Logger(WalletAuthService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly challenges: ChallengesRepository,
    private readonly blockhashes: BlockhashSource,
    private readonly users: UsersRepository,
    private readonly tokens: TokenService,
  ) {}

  /**
   * Шаг 1. Текст вызова привязан к домену фронтенда, адресу, сети и сроку:
   * подпись для другого сайта или другого адреса здесь не пройдёт.
   */
  async createChallenge({
    chain,
    address,
  }: ChallengeRequest): Promise<IssuedChallenge> {
    const now = new Date();
    if (
      (await this.challenges.countPending(chain, address, now)) >=
      MAX_PENDING_PER_ADDRESS
    ) {
      throw new HttpException(
        'Слишком много запросов на вход для этого адреса. Подожди пару минут.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const expiresAt = new Date(
      now.getTime() + this.config.CHALLENGE_TTL_SECONDS * 1000,
    );
    const nonce = randomBytes(16).toString('hex');
    const message = [
      'Divra: вход в аккаунт',
      `Домен: ${this.config.APP_DOMAIN}`,
      `Адрес: ${address}`,
      `Сеть: Solana ${this.config.SOLANA_CLUSTER}`,
      `Nonce: ${nonce}`,
      `Выдано: ${now.toISOString()}`,
      `Истекает: ${expiresAt.toISOString()}`,
      'Транзакция не отправляется в сеть и ничего не списывает.',
    ].join('\n');

    const blockhash = await this.blockhashes.latest();
    const transaction = buildChallengeTransaction(
      toAddress(address),
      message,
      blockhash,
    );
    const challenge = await this.challenges.create(
      {
        chain,
        address,
        message,
        messageHash: transaction.messageHash,
        blockhash,
        expiresAt,
      },
      now,
    );
    return {
      chain,
      challengeId: challenge.id,
      transaction: transaction.wire,
      message,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Шаг 2. Вызов забирается первым делом и одной записью: повторить его нельзя ни после
   * успеха, ни после ошибки. Затем — подпись адреса ровно под выданным сообщением.
   */
  async verify({
    challengeId,
    chain,
    address,
    signedPayload,
  }: VerifyRequest): Promise<WalletSignIn> {
    const challenge = await this.challenges.consume(challengeId, new Date());
    if (
      !challenge ||
      challenge.chain !== chain ||
      challenge.address !== address
    ) {
      throw rejected();
    }
    const signer = toAddress(address);
    const signed = decodeSignedTransaction(signedPayload, signer);
    if (!signed?.signature) {
      throw rejected();
    }
    const sameMessage =
      signed.messageHash === challenge.messageHash ||
      matchesChallengeMessage(signed.messageBytes, {
        payer: address,
        memo: challenge.message,
        blockhash: challenge.blockhash,
      });
    if (
      !sameMessage ||
      !(await verifyEd25519(signer, signed.signature, signed.messageBytes))
    ) {
      throw rejected();
    }

    const { user, created } = await this.users.signInWithWallet({
      chain,
      address,
    });
    // amr=swk: доказано владение программным ключом (RFC 8176)
    const tokens = await this.tokens.issue(user.id, {
      method: 'solana-wallet',
      claims: { amr: ['swk'] },
    });
    if (created) {
      this.logger.log(`Новый пользователь ${user.id}`);
    }
    return { user: { id: user.id, chain, address, created }, tokens };
  }
}
