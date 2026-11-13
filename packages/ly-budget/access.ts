import type {
  BaseListTypeInfo,
  ListOperationAccessControl,
} from '@keystone-6/core/types'
import { accessControlStrategy } from './security-config'

type Role = 'admin' | 'moderator' | 'editor' | 'contributor'
type Access = ListOperationAccessControl<
  'query' | 'create' | 'update' | 'delete',
  BaseListTypeInfo
>

// Only accept the User identity loaded by createAuth after cookie verification.
// Do not use lilith-core's allowRoles: it bypasses authentication in gql/preview.
export const allowRoles =
  (...roles: Role[]): Access =>
  ({ session }) =>
    accessControlStrategy === 'cms' &&
    session?.listKey === 'User' &&
    typeof session.itemId === 'string' &&
    session.itemId === session.data?.id &&
    roles.includes(session.data?.role)

export const isAdmin = allowRoles('admin')
export const canUseAdminUI = allowRoles(
  'admin',
  'moderator',
  'editor',
  'contributor'
)

const deny = () => false
const publicReadOnly = {
  query: () => true,
  create: deny,
  update: deny,
  delete: deny,
}

export const gqlReadOnly = () => {
  if (accessControlStrategy !== 'cms') return publicReadOnly
  return canUseAdminUI
}

export const gqlReadAndCreate = () => {
  if (accessControlStrategy !== 'cms') return publicReadOnly
  return {
    query: canUseAdminUI,
    create: allowRoles('admin', 'moderator'),
    update: allowRoles('admin', 'moderator'),
    delete: allowRoles('admin', 'moderator'),
  }
}

export const User = {
  query: allowRoles('admin', 'moderator', 'editor'),
  update: allowRoles('admin', 'moderator', 'editor'),
  create: allowRoles('admin', 'moderator'),
  delete: isAdmin,
}

// Editors may only edit themselves. Moderators cannot take over an admin account
// by replacing its email/password, or change another protected account.
export const userUpdateFilter = ({ session }: Parameters<Access>[0]) => {
  if (accessControlStrategy !== 'cms') return false
  if (session?.data?.role === 'admin') return true
  if (session?.data?.role === 'moderator') {
    return {
      AND: [
        { role: { not: { equals: 'admin' } } },
        { isProtected: { equals: false } },
      ],
    }
  }
  if (session?.data?.role === 'editor' && session.itemId) {
    return { id: { equals: session.itemId } }
  }
  return false
}
