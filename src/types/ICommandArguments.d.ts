// this is from nodejs types
interface ParseArgsOptionConfig {
  /**
   * Type of argument.
   */
  type: 'string' | 'boolean';
  /**
   * Whether this option can be provided multiple times.
   * If `true`, all values will be collected in an array.
   * If `false`, values for the option are last-wins.
   * @default false.
   */
  multiple?: boolean | undefined;
  /**
   * A single character alias for the option.
   */
  short?: string | undefined;
  /**
   * The default option value when it is not set by args.
   * It must be of the same type as the the `type` property.
   * When `multiple` is `true`, it must be an array.
   * @since v18.11.0
   */
  default?: string | boolean | string[] | boolean[] | undefined;
}

interface ParseArgsOptionsConfigExtended extends ParseArgsOptionConfig {
  /**
   * A description of the option.
   */
  description?: string;

  /**
   * Is it required?
   */
  required?: boolean;
}

export interface ICommandArguments {
  [longOption: string]: ParseArgsOptionsConfigExtended;
}
