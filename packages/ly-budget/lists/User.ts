import { list } from '@keystone-6/core'

import { text, password, select, checkbox } from '@keystone-6/core/fields'
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
    }),
    password: password({
      label: '密碼',
      validation: { isRequired: true },
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
      initialColumns: ['name', 'role'],
    },
  },
  access: {
    operation: User,
    filter: { update: userUpdateFilter },
  },
})

export default listConfigurations
