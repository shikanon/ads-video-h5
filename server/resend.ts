export async function sendRegistrationCode(email: string, code: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from) throw new Error('邮箱发信服务尚未配置。');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [email],
      subject: '轻剪注册验证码',
      text: `你的轻剪注册验证码是 ${code}。10 分钟内有效。若非本人操作，请忽略此邮件。`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    // The response may contain account details; never forward it to the browser or logs.
    throw new Error(`邮件发送失败（${response.status}）。请检查 Resend 发信域名配置。`);
  }
}
