import 'dotenv/config'
import { config } from '@keystone-6/core'
import { listDefinition as lists } from './lists'
import envVar from './environment-variables'
import express from 'express'
import { createCmsSession } from './session'
import {
  registerGoogleOAuth,
  googleAuthSchema,
  readGoogleOAuthConfig,
} from './google-auth'
import { isReadOnly } from './security-config'
import { canUseAdminUI } from './access'
import { readOnlySchema } from './read-only-schema'
import Keyv from 'keyv'
import { KeyvAdapter } from '@apollo/utils.keyvadapter'
import { ApolloServerPluginCacheControl } from '@apollo/server/plugin/cacheControl'
import responseCachePlugin from '@apollo/server-plugin-response-cache'
import { GraphQLConfig } from '@keystone-6/core/types'
import { proposalImageThumbnailHandler } from './proposal-image-thumbnail'

const cmsSession = isReadOnly ? undefined : createCmsSession()

// run.sh invokes this before migrations, so missing OAuth settings cannot remove
// password support from the database and then leave the CMS unable to start.
export function validateCmsRuntime() {
  if (cmsSession) {
    cmsSession.initialize()
    readGoogleOAuthConfig()
  }
}

const graphqlConfig: GraphQLConfig = {
  apolloConfig:
    envVar.accessControlStrategy === 'gql' && envVar.cache.isEnabled
      ? {
          plugins: [
            responseCachePlugin(),
            ApolloServerPluginCacheControl({
              defaultMaxAge: envVar.cache.maxAge,
            }),
          ],
          cache: new KeyvAdapter(
            new Keyv(envVar.cache.url, {
              lazyConnect: true,
              namespace: envVar.cache.identifier,
              connectionName: envVar.cache.identifier,
              connectTimeout: envVar.cache.connectTimeOut,
            })
          ),
        }
      : undefined,
}

const keystoneConfig = config({
  db: {
    provider: envVar.database.provider,
    url: envVar.database.url,
    idField: {
      kind: 'autoincrement',
    },
  },
  ui: {
    // If `isDisabled` is set to `true` then the Admin UI will be completely disabled.
    isDisabled: envVar.isUIDisabled,
    publicPages: isReadOnly ? [] : ['/signin'],
    pageMiddleware: isReadOnly
      ? undefined
      : async ({ wasAccessAllowed }) => {
          if (!wasAccessAllowed) return { kind: 'redirect', to: '/signin' }
        },
    isAccessAllowed: (context) =>
      canUseAdminUI({
        session: context.session,
        context,
        listKey: 'User',
        operation: 'query',
      }),
  },
  graphql: graphqlConfig,
  extendGraphqlSchema: isReadOnly ? readOnlySchema : googleAuthSchema,
  lists,
  session: cmsSession?.session,
  storage: {
    files: {
      kind: 'local',
      type: 'file',
      storagePath: envVar.files.storagePath,
      serverRoute: {
        path: '/files',
      },
      generateUrl: (path) => `${envVar.files.baseUrl}${path}`,
    },
    images: {
      kind: 'local',
      type: 'image',
      storagePath: envVar.images.storagePath,
      serverRoute: {
        path: '/images',
      },
      generateUrl: (path) => `${envVar.images.baseUrl}${path}`,
    },
  },
  server: {
    healthCheck: {
      path: '/health_check',
      data: { status: 'healthy' },
    },
    maxFileSize: 2000 * 1024 * 1024,
    extendExpressApp: (app, context) => {
      // Fail closed before serving HTTP if the CMS secret is missing or unsafe.
      validateCmsRuntime()
      if (cmsSession) registerGoogleOAuth(app, context, cmsSession.session)
      app.get('/api/proposal-image-thumbnail', proposalImageThumbnailHandler)

      // This middleware is available in Express v4.16.0 onwards
      // Set to 50mb because DraftJS Editor playload could be really large

      const jsonBodyParser = express.json({ limit: '500mb' })
      app.use(jsonBodyParser)

      // Enable CORS for non-production environments
      if (process.env.NODE_ENV === 'development') {
        app.use((req, res, next) => {
          res.header('Access-Control-Allow-Origin', '*')
          res.header(
            'Access-Control-Allow-Methods',
            'GET, POST, PUT, DELETE, OPTIONS'
          )
          res.header(
            'Access-Control-Allow-Headers',
            'Origin, X-Requested-With, Content-Type, Accept, Authorization'
          )

          if (req.method === 'OPTIONS') {
            res.sendStatus(200)
          } else {
            next()
          }
        })
      }
    },
  },
})

// Public services have no authentication/bootstrap/logout mutations or sessions.
export default keystoneConfig
