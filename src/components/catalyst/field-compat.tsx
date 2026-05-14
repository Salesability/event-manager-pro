'use client';

import { useMemo } from 'react';
import { ErrorMessage } from './fieldset';

type FieldErrorProps = {
  children?: React.ReactNode;
  errors?: Array<{ message?: string } | undefined>;
  className?: string;
};

export function FieldError({ children, errors, className }: FieldErrorProps) {
  const content = useMemo(() => {
    if (children) return children;
    if (!errors?.length) return null;
    const unique = [...new Map(errors.map((e) => [e?.message, e])).values()];
    if (unique.length === 1) return unique[0]?.message;
    return (
      <ul className="ml-4 flex list-disc flex-col gap-1">
        {unique.map((e, i) => e?.message && <li key={i}>{e.message}</li>)}
      </ul>
    );
  }, [children, errors]);

  if (!content) return null;
  return <ErrorMessage className={className}>{content}</ErrorMessage>;
}
