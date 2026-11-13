import User from './User'
import Term from './Term'
import Committee from './Committee'
import People from './People'
import Party from './Party'
import Government from './Government'
import Budget from './Budget'
import BudgetYear from './BudgetYear'
import Meeting from './Meeting'
import Proposal from './Proposal'
import RecognitionImage from './RecognitionImage'
import RecognitionStatus from './RecognitionStatus'
import { isReadOnly } from '../security-config'

export const listDefinition = {
  User,
  Term,
  Committee,
  People,
  Party,
  Government,
  Budget,
  BudgetYear,
  Meeting,
  Proposal,
  RecognitionImage,
  RecognitionStatus,
}

// Apply the restriction to every list, including lists added in the future.
if (isReadOnly) {
  for (const [key, definition] of Object.entries(listDefinition)) {
    const access = definition.access
    const operation = typeof access === 'function' ? access : access.operation
    const existingOmit = definition.graphql?.omit
    definition.graphql = {
      ...definition.graphql,
      omit:
        key === 'User' || existingOmit === true
          ? true
          : { ...existingOmit, create: true, update: true, delete: true },
    }
    definition.access = {
      ...(typeof access === 'function' ? {} : access),
      operation: {
        query:
          key === 'User'
            ? () => false
            : typeof operation === 'function'
            ? operation
            : operation.query,
        create: () => false,
        update: () => false,
        delete: () => false,
      },
    }
  }
}
