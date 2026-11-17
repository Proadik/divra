import { env } from '@/shared/config'
import { api } from '../client'
import {
  type AcceptInviteResponse,
  type AddMemberRequest,
  type CreateInviteRequest,
  type Invite,
  type InvitePreview,
  acceptInviteResponseSchema,
  addMemberRequestSchema,
  createInviteRequestSchema,
  inviteCodeSchema,
  invitePreviewSchema,
  inviteSchema,
} from './members-schemas'
import { type GroupMember, memberSchema } from './schemas'

const loadMock = async (): Promise<(typeof import('../mock/groups'))['mockGroupsBackend']> =>
  (await import('../mock/groups')).mockGroupsBackend

const groupPath = (groupId: string): string => `/groups/${encodeURIComponent(groupId)}`

/** Добавить участника по имени — без кошелька, статус pending. */
export const addMember = async (groupId: string, input: AddMemberRequest): Promise<GroupMember> => {
  const body = addMemberRequestSchema.parse(input)
  const response = env.GROUPS_MOCK
    ? await (await loadMock()).addMember(groupId, body)
    : await api.post<unknown>(`${groupPath(groupId)}/members`, body)
  return memberSchema.parse(response)
}

/** Ссылка-приглашение: общая или персональная (claimMemberId). */
export const createInvite = async (
  groupId: string,
  input: CreateInviteRequest = {},
): Promise<Invite> => {
  const body = createInviteRequestSchema.parse(input)
  const response = env.GROUPS_MOCK
    ? await (await loadMock()).createInvite(groupId, body)
    : await api.post<unknown>(`${groupPath(groupId)}/invites`, body)
  return inviteSchema.parse(response)
}

/** Превью приглашения. Доступно без входа. */
export const getInvitePreview = async (code: string): Promise<InvitePreview> => {
  const safeCode = inviteCodeSchema.parse(code)
  const response = env.GROUPS_MOCK
    ? await (await loadMock()).getInvitePreview(safeCode)
    : await api.get<unknown>(`/invites/${safeCode}`)
  return invitePreviewSchema.parse(response)
}

/** Принять приглашение. Нужна подтверждённая сессия кошелька. */
export const acceptInvite = async (code: string): Promise<AcceptInviteResponse> => {
  const safeCode = inviteCodeSchema.parse(code)
  const response = env.GROUPS_MOCK
    ? await (await loadMock()).acceptInvite(safeCode)
    : await api.post<unknown>(`/invites/${safeCode}/accept`)
  return acceptInviteResponseSchema.parse(response)
}

export const inviteKeys = {
  all: ['invites'] as const,
  preview: (code: string) => [...inviteKeys.all, code] as const,
}
