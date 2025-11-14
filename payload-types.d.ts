/**
 * Minimal type definitions for Payload CMS
 * This allows the package to compile without having payload as a devDependency
 * The actual types come from the user's installed payload package (peerDependency)
 */

declare module "payload" {
  /**
   * Payload Config type
   * Compatible with both Payload v2 and v3
   */
  export type Config = {
    collections?: any[];
    globals?: any[];
    plugins?: any[];
    onInit?: (payload: any) => Promise<void> | void;
    [key: string]: any;
  };

  /**
   * Payload instance type
   */
  export type Payload = {
    logger: {
      info: (message: string) => void;
      warn: (message: string) => void;
      error: (message: string) => void;
    };
    [key: string]: any;
  };

  const payload: Payload;
  export default payload;
}

