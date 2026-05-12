import 'server-only';
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from '@react-email/components';
import { render } from '@react-email/render';

// First React Email template in the codebase (0026 Phase 4). Pattern: each
// template module exports a JSX component for the React Email preview tooling
// plus a `<name>Email()` factory that returns `{ subject, html, text }` for
// the Server Action consumer. Mirrors the shape of the older text-only
// helpers in `../templates.ts` so action call-sites stay symmetric.
//
// v1 design: the quote PDF is attached and the body asks the recipient to
// reply or phone us to accept / request changes. No in-email Accept/Decline
// buttons — corporate email scanners (Microsoft Safe Links, Mimecast, etc.)
// prefetch every URL in incoming mail, which would auto-accept any quote
// before the human ever read it. Coach owns the accept/decline transition
// via staff-side Server Actions.

const cad = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });

export type QuoteEmailFields = {
  /** First name of the recipient contact for the salutation. */
  firstName: string;
  /** Quote row identity (renders as `Quote #N`). */
  quoteNumber: string;
  /** Dealer (client) name — appears in the body and the subject's tail. */
  clientName: string;
  /** Issued date as `YYYY-MM-DD` (rendered ISO). */
  issuedDate: string;
  /** Final quote total in CAD dollars. */
  total: number;
};

export function QuoteEmail(f: QuoteEmailFields) {
  const totalStr = cad.format(f.total);
  return (
    <Html lang="en">
      <Head />
      <Preview>{`Your Salesability Quote — ${totalStr}`}</Preview>
      <Body
        style={{
          backgroundColor: '#f6f7f9',
          fontFamily:
            'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          margin: 0,
          padding: '24px 0',
        }}
      >
        <Container
          style={{
            backgroundColor: '#ffffff',
            border: '1px solid #e3e6ea',
            borderRadius: '8px',
            margin: '0 auto',
            maxWidth: '560px',
            padding: '32px',
          }}
        >
          <Heading
            as="h1"
            style={{
              color: '#111111',
              fontSize: '20px',
              margin: '0 0 12px 0',
            }}
          >
            Your Salesability Quote
          </Heading>
          <Text style={{ color: '#444444', fontSize: '14px', margin: '0 0 16px 0' }}>
            Hi {f.firstName || 'there'},
          </Text>
          <Text style={{ color: '#444444', fontSize: '14px', margin: '0 0 16px 0' }}>
            Please find your quote for {f.clientName} attached as a PDF. Total:{' '}
            <strong style={{ color: '#111111' }}>{totalStr}</strong> (Quote #
            {f.quoteNumber}, issued {f.issuedDate}).
          </Text>
          <Text style={{ color: '#444444', fontSize: '14px', margin: '0 0 16px 0' }}>
            To accept this quote or request changes, reply to this email or call
            us at <strong style={{ color: '#111111' }}>(902) 802-6215</strong>.
          </Text>
          <Text style={{ color: '#6b7280', fontSize: '12px', margin: '24px 0 0 0' }}>
            Salesability Canada Inc. &middot; Dartmouth, NS
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export type QuoteEmailRender = {
  subject: string;
  html: string;
  text: string;
};

export async function quoteEmail(f: QuoteEmailFields): Promise<QuoteEmailRender> {
  const subject = `Your Salesability Quote — Quote #${f.quoteNumber}`;
  const element = QuoteEmail(f);
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);
  return { subject, html, text };
}
