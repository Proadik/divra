import { z } from 'zod';
import {
  EXPENSE_CATEGORIES,
  FIAT_CURRENCIES,
  GROUP_KINDS,
  SPLIT_MODES,
} from '../database/schema/index.js';
import { MAX_MEMBERS_PER_GROUP } from './repositories/groups.repository.js';

/**
 * Невидимые и управляющие символы: bidi-переопределения (U+202A–202E, U+2066–2069) переворачивают
 * текст на экране и годятся для подмены имён; нулевой ширины — делают два «одинаковых» имени разными.
 * ZWJ (U+200D) не трогаем — без него ломаются составные эмодзи.
 */
const UNSAFE_CHARS = /[\p{Cc}​‎‏‪-‮⁦-⁩﻿]/u;

/** Имя, которое увидят другие люди: NFC, пробелы схлопнуты, без невидимых символов */
export const humanText = (max: number, emptyMessage: string) =>
  z
    .string()
    .max(max * 4)
    .refine((value) => !UNSAFE_CHARS.test(value), 'Недопустимые символы')
    .transform((value) => value.normalize('NFC').replace(/\s+/g, ' ').trim())
    .pipe(
      z.string().min(1, emptyMessage).max(max, `Не длиннее ${max} символов`),
    );

/** Необязательный текст (сообщение к запросу): те же правила, пустая строка допустима */
export const optionalText = (max: number) =>
  z
    .string()
    .max(max * 4)
    .refine((value) => !UNSAFE_CHARS.test(value), 'Недопустимые символы')
    .transform((value) => value.normalize('NFC').replace(/\s+/g, ' ').trim())
    .pipe(z.string().max(max, `Не длиннее ${max} символов`));

export const createGroupRequestSchema = z.strictObject({
  name: humanText(40, 'Назови группу'),
  kind: z.enum(GROUP_KINDS),
});

export const addMemberRequestSchema = z.strictObject({
  displayName: humanText(32, 'Введи имя'),
});

/** Сумма в долларах → целые центы. Больше двух знаков после запятой — ошибка, а не округление */
const toCents = (value: number): number => Math.round(value * 100);
const dollars = z
  .number()
  .finite()
  .refine(
    (value) => Math.abs(value * 100 - toCents(value)) < 1e-6,
    'Не больше двух знаков после запятой',
  )
  .transform(toCents);

/** Не больше $1 000 000 за расход — как и во фронтенде; в центах влезает в int4 */
export const MAX_EXPENSE_CENTS = 100_000_000;

export const createExpenseRequestSchema = z
  .strictObject({
    title: humanText(60, 'Напиши, на что потратили'),
    category: z.enum(EXPENSE_CATEGORIES),
    paidById: z.uuid(),
    amount: dollars.pipe(
      z
        .number()
        .int()
        .positive('Сумма должна быть больше нуля')
        .max(MAX_EXPENSE_CENTS, 'Сумма больше 1 000 000'),
    ),
    splitMode: z.enum(SPLIT_MODES),
    original: z
      .strictObject({
        currency: z.enum(FIAT_CURRENCIES),
        amount: z.number().finite().positive().max(1e13),
        rate: z.number().finite().positive().max(1e9),
      })
      .optional(),
    shares: z
      .array(
        z.strictObject({
          memberId: z.uuid(),
          amount: dollars.pipe(z.number().int().nonnegative()),
        }),
      )
      .min(1, 'Выбери хотя бы одного участника')
      .max(MAX_MEMBERS_PER_GROUP),
  })
  .superRefine((value, ctx) => {
    const ids = new Set(value.shares.map((share) => share.memberId));
    if (ids.size !== value.shares.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['shares'],
        message: 'Участник указан дважды',
      });
    }
    const total = value.shares.reduce((sum, share) => sum + share.amount, 0);
    if (total !== value.amount) {
      ctx.addIssue({
        code: 'custom',
        path: ['shares'],
        message: 'Сумма долей не равна сумме расхода',
      });
    }
    // Исходная сумма и курс должны давать ту же сумму в долларах (до цента — округление).
    // Иначе в ленте можно показать «10 000 ₸», а записать $1000.
    if (value.original) {
      const expected = Math.round(
        (value.original.amount * 100) / value.original.rate,
      );
      if (Math.abs(expected - value.amount) > 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['original'],
          message: 'Сумма не совпадает с исходной суммой и курсом',
        });
      }
    }
  });

export type CreateExpenseRequest = z.infer<typeof createExpenseRequestSchema>;
export type CreateGroupRequest = z.infer<typeof createGroupRequestSchema>;
export type AddMemberRequest = z.infer<typeof addMemberRequestSchema>;
