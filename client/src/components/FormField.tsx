import type { UseFormRegisterReturn } from "react-hook-form";

interface FormFieldProps {
  label: string;
  type?: string;
  error?: string;
  readOnly?: boolean;
  multiline?: boolean;
  registration: UseFormRegisterReturn;
}

export function FormField({ label, type = "text", error, readOnly = false, multiline = false, registration }: FormFieldProps) {
  return (
    <div className="field">
      <label>
        {label}
        {readOnly && <span className="mirror-badge"> · read-only</span>}
      </label>
      {multiline ? (
        <textarea rows={4} readOnly={readOnly} {...registration} />
      ) : (
        <input type={type} readOnly={readOnly} {...registration} />
      )}
      {error && <span className="error">{error}</span>}
    </div>
  );
}
