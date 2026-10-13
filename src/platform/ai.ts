import { languageModel, ModelConfigError, modelConfigFromEnv } from '@kete/ai';

// The app's model (@kete/ai): chosen by configuration — `KETE_AI_PROVIDER`, `KETE_AI_MODEL`,
// `KETE_AI_API_KEY` — never named in the code. Without one, « Demander » says it is not connected.

type Model = ReturnType<typeof languageModel>;
let override: Model | null | undefined;

export function getModel(): Model | null {
  if (override !== undefined) return override;
  try {
    return languageModel(modelConfigFromEnv());
  } catch (error) {
    if (error instanceof ModelConfigError) return null;
    throw error;
  }
}

/** Tests: a scripted model, or none (`null`); `undefined` goes back to the configuration. */
export function useModel(model: Model | null | undefined): void {
  override = model;
}
