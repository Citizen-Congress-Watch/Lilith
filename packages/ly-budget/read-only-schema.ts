import { graphql } from '@keystone-6/core'

// Keystone 5.2.0's context.db requires a Mutation type, even when every list's
// mutations are omitted. Keep one always-denied field so the schema remains
// valid, without exposing any database write or authentication operation.
export const readOnlySchema = graphql.extend({
  mutation: {
    _readOnly: graphql.field({
      type: graphql.Boolean,
      resolve() {
        throw new Error('Mutations are disabled on this read-only service')
      },
    }),
  },
})
