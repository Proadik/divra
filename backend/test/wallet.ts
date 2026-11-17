import {
  type Address,
  generateKeyPair,
  getAddressFromPublicKey,
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  partiallySignTransaction,
  signBytes,
} from '@solana/kit';

/** Кошелёк для тестов: настоящая пара ключей Ed25519, подписывает так же, как Phantom */
export interface TestWallet {
  address: Address;
  sign: (base64Transaction: string) => Promise<string>;
  /** Злоумышленник: своей подписью в слот чужого адреса (кошелёк так не сделает — делаем вручную) */
  forgeAs: (base64Transaction: string, victim: Address) => Promise<string>;
}

export const createTestWallet = async (): Promise<TestWallet> => {
  const keyPair = await generateKeyPair();
  const address = await getAddressFromPublicKey(keyPair.publicKey);
  return {
    address,
    sign: async (base64Transaction) => {
      const transaction = getTransactionDecoder().decode(
        Buffer.from(base64Transaction, 'base64'),
      );
      // Частичная подпись: второй подписант вызова — ключ, которого нет ни у кого
      const signed = await partiallySignTransaction([keyPair], transaction);
      return getBase64EncodedWireTransaction(signed);
    },
    forgeAs: async (base64Transaction, victim) => {
      const transaction = getTransactionDecoder().decode(
        Buffer.from(base64Transaction, 'base64'),
      );
      const signature = await signBytes(
        keyPair.privateKey,
        transaction.messageBytes,
      );
      const forged = {
        ...transaction,
        signatures: { ...transaction.signatures, [victim]: signature },
      };
      return getBase64EncodedWireTransaction(forged);
    },
  };
};
