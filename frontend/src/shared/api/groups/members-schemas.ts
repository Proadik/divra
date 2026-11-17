import { z } from 'zod'

/** Код приглашения, base64url. До 256 символов: в моке в код зашиты данные приглашения. */
export const inviteCodeSchema = z.string().regex(/^[\w-]{8,256}$/, 'Некорректный код приглашения')

export const addMemberRequestSchema = z.object({
  displayName: z.string().trim().min(1, 'Введи имя').max(32, 'Не длиннее 32 символов'),
})

export const createInviteRequestSchema = z.object({
  /** Персональная ссылка: кто перейдёт по ней, «заберёт» этого участника без кошелька */
  claimMemberId: z.string().min(1).optional(),
})

export const inviteSchema = z.object({
  code: inviteCodeSchema,
  url: z.url(),
  expiresAt: z.iso.datetime(),
  claimMemberId: z.string().nullable(),
})

/** Что видит человек по ссылке ещё до входа */
export const invitePreviewSchema = z.object({
  code: inviteCodeSchema,
  groupId: z.string().min(1),
  groupName: z.string().min(1),
  invitedByName: z.string().min(1),
  membersCount: z.number().int().positive(),
  /** Имя участника, которого «заберёт» вошедший; null — общая ссылка */
  claimMemberName: z.string().nullable(),
  expiresAt: z.iso.datetime(),
})

export const acceptInviteResponseSchema = z.object({
  groupId: z.string().min(1),
  memberId: z.string().min(1),
  /** Этот кошелёк уже состоит в группе — ничего не изменилось */
  alreadyMember: z.boolean(),
})

export type AddMemberRequest = z.infer<typeof addMemberRequestSchema>
export type CreateInviteRequest = z.infer<typeof createInviteRequestSchema>
export type Invite = z.infer<typeof inviteSchema>
export type InvitePreview = z.infer<typeof invitePreviewSchema>
export type AcceptInviteResponse = z.infer<typeof acceptInviteResponseSchema>
