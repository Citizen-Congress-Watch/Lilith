import { list } from '@keystone-6/core'

import { text, select, checkbox } from '@keystone-6/core/fields'
import { User, isAdmin, userUpdateFilter } from '../access'

const listConfigurations = list({
  fields: {
    name: text({
      label: '姓名',
      validation: { isRequired: true },
    }),
    email: text({
      label: 'Email',
      validation: { isRequired: true },
      isIndexed: 'unique',
      isFilterable: true,
      access: { update: isAdmin },
      hooks: {
        resolveInput: ({ resolvedData, fieldKey }) => {
          const value = resolvedData[fieldKey]
          return typeof value === 'string' ? value.trim().toLowerCase() : value
        },
      },
    }),
    googleSubject: text({
      label: 'Google 帳號識別碼',
      db: { isNullable: true },
      isIndexed: 'unique',
      access: {
        read: (args) => isAdmin({ ...args, operation: 'query' }),
        create: isAdmin,
        update: isAdmin,
      },
      ui: {
        description:
          'Google 的 sub。通常在首次登入時自動綁定；只有管理員可以重設。',
      },
      hooks: {
        resolveInput: ({ resolvedData, fieldKey }) => {
          const value = resolvedData[fieldKey]
          return typeof value === 'string' ? value.trim() || null : value
        },
      },
    }),
    isActive: checkbox({
      label: '允許登入',
      defaultValue: true,
      access: { create: isAdmin, update: isAdmin },
    }),
    role: select({
      label: '角色權限',
      type: 'string',
      defaultValue: 'contributor',
      access: { create: isAdmin, update: isAdmin },
      options: [
        {
          label: 'admin',
          value: 'admin',
        },
        {
          label: 'moderator',
          value: 'moderator',
        },
        {
          label: 'editor',
          value: 'editor',
        },
        {
          label: 'contributor',
          value: 'contributor',
        },
      ],
      validation: { isRequired: true },
    }),
    isProtected: checkbox({
      defaultValue: false,
      access: { create: isAdmin, update: isAdmin },
    }),
  },

  ui: {
    listView: {
      initialColumns: ['name', 'email', 'role', 'isActive'],
    },
  },
  access: {
    operation: User,
    filter: { update: userUpdateFilter },
  },
})

export default listConfigurations
