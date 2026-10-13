import { createLogger } from '@kete/log';
import { APP_SLUG } from './app';

/**
 * The app's logs (@kete/log): one JSON line per event, tokens, e-mails and phone numbers taken
 * out, each line tied to its trace. `KETE_LOG_LEVEL` sets the level.
 */
export const log = createLogger({ service: APP_SLUG });
