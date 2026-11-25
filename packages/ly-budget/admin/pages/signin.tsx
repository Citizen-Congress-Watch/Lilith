import Head from 'next/head'
import { useRouter } from 'next/router'

export default function SignIn() {
  const { query } = useRouter()
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: '#f5f7fa',
      }}
    >
      <Head>
        <title>登入｜國會預算監督平台</title>
      </Head>
      <section
        style={{
          maxWidth: 420,
          margin: 24,
          padding: 40,
          background: 'white',
          borderRadius: 12,
        }}
      >
        <h1 style={{ fontSize: 24 }}>登入國會預算監督平台</h1>
        <p>請使用管理員已開通的 Google 帳號登入。</p>
        {query.error && (
          <p role="alert" style={{ color: '#a32020' }}>
            無法完成登入。請確認選擇的帳號已開通且未停用，或聯絡管理員。
          </p>
        )}
        <a
          href="/auth/google"
          style={{
            display: 'block',
            marginTop: 24,
            padding: 14,
            textAlign: 'center',
            border: '1px solid #747775',
            borderRadius: 6,
            color: '#1f1f1f',
            textDecoration: 'none',
          }}
        >
          使用 Google 帳號登入
        </a>
      </section>
    </main>
  )
}
