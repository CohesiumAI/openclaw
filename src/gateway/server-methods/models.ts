import type { GatewayRequestHandlers } from "./types.js";
import { buildAllowedModelSet, resolveDefaultModelForAgent } from "../../agents/model-selection.js";
import { loadConfig } from "../../config/config.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateModelsListParams,
} from "../protocol/index.js";

export const modelsHandlers: GatewayRequestHandlers = {
  "models.list": async ({ params, respond, context }) => {
    if (!validateModelsListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid models.list params: ${formatValidationErrors(validateModelsListParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const catalog = await context.loadGatewayModelCatalog();
      const cfg = loadConfig();
      const resolved = resolveDefaultModelForAgent({ cfg });
      const { allowAny, allowedCatalog } = buildAllowedModelSet({
        cfg,
        catalog,
        defaultProvider: resolved.provider,
        defaultModel: resolved.model,
      });
      respond(true, { models: allowAny ? catalog : allowedCatalog }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
};
