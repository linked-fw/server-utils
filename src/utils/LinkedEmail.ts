import { sharedState } from '@_linked/core/utils/sharedState';

export interface IEmailProvider {
  send(emailOptions: EmailOptions): Promise<void>;
}
export interface EmailContact {
  address: string;
  name: string;
}

export interface EmailOptions {
  bounce_address?: string;
  from?: EmailContact;
  to: { email_address: EmailContact }[];
  subject: string;
  htmlbody: string;
}

/**
 * The default email provider, shared by every copy of this module in the process: an email
 * package sets it through one copy and `LinkedEmail.send` may run on another. See
 * https://github.com/linked-fw/cli/blob/main/docs/architecture/shared-state-and-error-brands.md.
 */
const emailState = sharedState('@_linked/server-utils', 'LinkedEmail', () => ({
  provider: undefined as IEmailProvider | undefined,
}));

export class LinkedEmail {
  private static get provider(): IEmailProvider | undefined {
    return emailState.provider;
  }
  private static set provider(provider: IEmailProvider | undefined) {
    emailState.provider = provider;
  }

  static setDefaultProvider(provider: IEmailProvider) {
    this.provider = provider;
  }
  static hasDefaultProvider() {
    return this.provider && true;
  }
  static send(emailOptions: EmailOptions) {
    if (!this.provider)
      throw new Error(
        'No email provider set. Make sure the package of your email provider is added to package.json of the application.'
      );
    return this.provider.send(emailOptions);
  }
}
