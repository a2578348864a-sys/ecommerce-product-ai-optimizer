import productCreativeHandoffJsonSchema from "@/lib/product-creative-handoff.schema.json";
import { parseProductCreativeHandoff } from "@/lib/productCreativeHandoff";

export const PRODUCT_CREATIVE_HANDOFF_JSON_SCHEMA = productCreativeHandoffJsonSchema;

export type ProductCreativeHandoffSchemaValidationResult =
  | { valid: true; errors: [] }
  | { valid: false; errors: ["invalid_product_creative_handoff"] };

export function validateProductCreativeHandoffSchema(
  value: unknown,
): ProductCreativeHandoffSchemaValidationResult {
  return parseProductCreativeHandoff(value)
    ? { valid: true, errors: [] }
    : { valid: false, errors: ["invalid_product_creative_handoff"] };
}
