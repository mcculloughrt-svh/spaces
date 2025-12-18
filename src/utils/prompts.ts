/**
 * User prompt utilities using @inquirer/prompts
 * Note: @inquirer/prompts is lazy-loaded to improve CLI startup time
 */

/**
 * Select an item from a searchable list
 * @param items Array of items to select from
 * @param message Prompt message
 * @returns Selected item or null if cancelled
 */
export async function selectItem(
  items: string[],
  message: string
): Promise<string | null> {
  if (items.length === 0) {
    return null;
  }

  try {
    const { search } = await import('@inquirer/prompts');
    const selected = await search({
      message,
      source: async (input) => {
        if (!input) {
          return items.map((item) => ({ name: item, value: item }));
        }

        // Filter items based on input
        const filtered = items.filter((item) =>
          item.toLowerCase().includes(input.toLowerCase())
        );

        return filtered.map((item) => ({ name: item, value: item }));
      },
    });

    return selected;
  } catch (error) {
    // User cancelled (Ctrl+C)
    return null;
  }
}

/**
 * Prompt for text input
 * @param message Prompt message
 * @param options Additional options
 * @returns Input value or null if cancelled
 */
export async function promptInput(
  message: string,
  options: {
    default?: string;
    validate?: (value: string) => boolean | string;
  } = {}
): Promise<string | null> {
  try {
    const { input } = await import('@inquirer/prompts');
    const value = await input({
      message,
      default: options.default,
      validate: options.validate,
    });

    return value;
  } catch (error) {
    // User cancelled (Ctrl+C)
    return null;
  }
}

/**
 * Prompt for confirmation
 * @param message Prompt message
 * @param defaultValue Default value
 * @returns Boolean response
 */
export async function promptConfirm(
  message: string,
  defaultValue = false
): Promise<boolean> {
  try {
    const { confirm } = await import('@inquirer/prompts');
    const value = await confirm({
      message,
      default: defaultValue,
    });

    return value;
  } catch (error) {
    // User cancelled (Ctrl+C), treat as false
    return false;
  }
}

/**
 * Prompt for password input
 * @param message Prompt message
 * @returns Password value or null if cancelled
 */
export async function promptPassword(
  message: string
): Promise<string | null> {
  try {
    const { password } = await import('@inquirer/prompts');
    const value = await password({
      message,
      mask: true,
    });

    return value;
  } catch (error) {
    // User cancelled (Ctrl+C)
    return null;
  }
}

/**
 * Multi-select items from a checkbox list
 * @param items Array of items with name and value
 * @param message Prompt message
 * @returns Array of selected values or empty array if cancelled
 */
export async function selectMultiple<T>(
  items: Array<{ name: string; value: T; checked?: boolean }>,
  message: string
): Promise<T[]> {
  if (items.length === 0) {
    return [];
  }

  try {
    const { checkbox } = await import('@inquirer/prompts');
    const selected = await checkbox({
      message,
      choices: items.map((item) => ({
        name: item.name,
        value: item.value,
        checked: item.checked ?? false,
      })),
    });

    return selected;
  } catch (error) {
    // User cancelled (Ctrl+C)
    return [];
  }
}
