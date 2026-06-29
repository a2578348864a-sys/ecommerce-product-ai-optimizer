export type AiOutputValidationStatus =
  | "valid"
  | "repaired"
  | "invalid_schema"
  | "blocked_by_safety_filter"
  | "parse_error"
  | "provider_error";

export type AiSchemaFieldError = {
  field: string;
  message: string;
};

type AiSchemaValidationBase = {
  schemaName: string;
  warnings?: string[];
  userMessage?: string;
};

export type AiSchemaValidationResult<T> =
  | (AiSchemaValidationBase & {
      ok: true;
      status: "valid" | "repaired";
      data: T;
      repairedFields?: string[];
    })
  | (AiSchemaValidationBase & {
      ok: false;
      status: "invalid_schema" | "blocked_by_safety_filter" | "parse_error" | "provider_error";
      fieldErrors?: AiSchemaFieldError[];
      debugMessage?: string;
      userMessage: string;
    });

export function validSchema<T>(
  schemaName: string,
  data: T,
  options: Pick<AiSchemaValidationBase, "warnings" | "userMessage"> = {},
): AiSchemaValidationResult<T> {
  return {
    ok: true,
    schemaName,
    status: "valid",
    data,
    ...options,
  };
}

export function repairedSchema<T>(
  schemaName: string,
  data: T,
  options: Pick<AiSchemaValidationBase, "warnings" | "userMessage"> & { repairedFields?: string[] } = {},
): AiSchemaValidationResult<T> {
  return {
    ok: true,
    schemaName,
    status: "repaired",
    data,
    ...options,
  };
}

export function invalidSchema<T>(
  schemaName: string,
  options: {
    status?: "invalid_schema" | "blocked_by_safety_filter" | "parse_error" | "provider_error";
    fieldErrors?: AiSchemaFieldError[];
    warnings?: string[];
    userMessage: string;
    debugMessage?: string;
  },
): AiSchemaValidationResult<T> {
  return {
    ok: false,
    schemaName,
    status: options.status ?? "invalid_schema",
    fieldErrors: options.fieldErrors,
    warnings: options.warnings,
    userMessage: options.userMessage,
    debugMessage: options.debugMessage,
  };
}
