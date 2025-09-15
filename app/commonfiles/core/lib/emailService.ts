// Email Service Utility for User Invitations
// This is a placeholder implementation that you can integrate with your preferred email service

export interface InvitationEmailData {
  to: string;
  from: string;
  subject: string;
  invitationToken: string;
  tenantName: string;
  invitedBy: string;
  role: string;
  department?: string;
  expiresAt: Date;
}

export interface EmailServiceConfig {
  apiKey: string;
  fromEmail: string;
  baseUrl: string;
}

class EmailService {
  private config: EmailServiceConfig | null = null;

  constructor(config?: EmailServiceConfig) {
    if (config) {
      this.config = config;
    }
  }

  /**
   * Configure the email service
   */
  configure(config: EmailServiceConfig) {
    this.config = config;
  }

  /**
   * Send a user invitation email
   */
  async sendInvitationEmail(data: InvitationEmailData): Promise<boolean> {
    try {
      if (!this.config) {
        console.warn('Email service not configured. Skipping email send.');
        return false;
      }

      const invitationUrl = `${this.config.baseUrl}/invite?token=${data.invitationToken}`;
      
      const emailContent = this.generateInvitationEmailContent(data, invitationUrl);
      
      // TODO: Integrate with your preferred email service
      // Examples:
      // - SendGrid: await this.sendWithSendGrid(data, emailContent);
      // - AWS SES: await this.sendWithSES(data, emailContent);
      // - Resend: await this.sendWithResend(data, emailContent);
      
      console.log('📧 Email invitation would be sent:', {
        to: data.to,
        subject: data.subject,
        invitationUrl,
        tenantName: data.tenantName
      });

      // For now, return true to simulate successful email send
      return true;
      
    } catch (error) {
      console.error('Failed to send invitation email:', error);
      return false;
    }
  }

  /**
   * Generate HTML email content for invitation
   */
  private generateInvitationEmailContent(data: InvitationEmailData, invitationUrl: string): string {
    const expirationDate = data.expiresAt.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>You're Invited to Join ${data.tenantName}</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #3b82f6; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
            .button { display: inline-block; background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; }
            .footer { text-align: center; margin-top: 30px; color: #6b7280; font-size: 14px; }
            .info-box { background: white; padding: 20px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #3b82f6; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>You're Invited! 🎉</h1>
              <p>Join ${data.tenantName} on our platform</p>
            </div>
            
            <div class="content">
              <p>Hello!</p>
              
              <p>You've been invited by <strong>${data.invitedBy}</strong> to join <strong>${data.tenantName}</strong> on our platform.</p>
              
              <div class="info-box">
                <h3>Invitation Details:</h3>
                <ul>
                  <li><strong>Role:</strong> ${data.role.charAt(0).toUpperCase() + data.role.slice(1)}</li>
                  ${data.department ? `<li><strong>Department:</strong> ${data.department}</li>` : ''}
                  <li><strong>Expires:</strong> ${expirationDate}</li>
                </ul>
              </div>
              
              <p>To accept this invitation and create your account, click the button below:</p>
              
              <div style="text-align: center; margin: 30px 0;">
                <a href="${invitationUrl}" class="button">Accept Invitation</a>
              </div>
              
              <p><strong>Important:</strong> This invitation will expire on ${expirationDate}. If you don't accept it by then, you'll need to request a new invitation.</p>
              
              <p>If you have any questions, please contact your organization administrator.</p>
              
              <p>Best regards,<br>The ${data.tenantName} Team</p>
            </div>
            
            <div class="footer">
              <p>This invitation was sent to ${data.to}</p>
              <p>If you didn't expect this invitation, you can safely ignore this email.</p>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  /**
   * Send invitation email using SendGrid (example implementation)
   */
  private async sendWithSendGrid(data: InvitationEmailData, htmlContent: string): Promise<boolean> {
    // TODO: Implement SendGrid integration
    // const sgMail = require('@sendgrid/mail');
    // sgMail.setApiKey(this.config!.apiKey);
    // 
    // const msg = {
    //   to: data.to,
    //   from: this.config!.fromEmail,
    //   subject: data.subject,
    //   html: htmlContent,
    // };
    // 
    // await sgMail.send(msg);
    return true;
  }

  /**
   * Send invitation email using AWS SES (example implementation)
   */
  private async sendWithSES(data: InvitationEmailData, htmlContent: string): Promise<boolean> {
    // TODO: Implement AWS SES integration
    // const AWS = require('aws-sdk');
    // const ses = new AWS.SES({ region: 'us-east-1' });
    // 
    // const params = {
    //   Source: this.config!.fromEmail,
    //   Destination: { ToAddresses: [data.to] },
    //   Message: {
    //     Subject: { Data: data.subject },
    //     Body: { Html: { Data: htmlContent } }
    //   }
    // };
    // 
    // await ses.sendEmail(params).promise();
    return true;
  }

  /**
   * Send invitation email using Resend (example implementation)
   */
  private async sendWithResend(data: InvitationEmailData, htmlContent: string): Promise<boolean> {
    // TODO: Implement Resend integration
    // const { Resend } = require('resend');
    // const resend = new Resend(this.config!.apiKey);
    // 
    // await resend.emails.send({
    //   from: this.config!.fromEmail,
    //   to: data.to,
    //   subject: data.subject,
    //   html: htmlContent,
    // });
    return true;
  }

  /**
   * Send invitation email using a custom SMTP server (example implementation)
   */
  private async sendWithSMTP(data: InvitationEmailData, htmlContent: string): Promise<boolean> {
    // TODO: Implement custom SMTP integration
    // const nodemailer = require('nodemailer');
    // 
    // const transporter = nodemailer.createTransporter({
    //   host: 'your-smtp-host.com',
    //   port: 587,
    //   secure: false,
    //   auth: {
    //     user: 'your-email@domain.com',
    //     pass: 'your-password'
    //   }
    // });
    // 
    // await transporter.sendMail({
    //   from: this.config!.fromEmail,
    //   to: data.to,
    //   subject: data.subject,
    //   html: htmlContent,
    // });
    return true;
  }
}

// Export singleton instance
export const emailService = new EmailService();

// Export the class for custom instances
export { EmailService };

// Helper function to send invitation emails
export async function sendInvitationEmail(
  email: string,
  invitationToken: string,
  tenantName: string,
  invitedBy: string,
  role: string,
  department?: string
): Promise<boolean> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // 7 days from now

  const emailData: InvitationEmailData = {
    to: email,
    from: 'noreply@yourdomain.com', // Configure this
    subject: `You're Invited to Join ${tenantName}`,
    invitationToken,
    tenantName,
    invitedBy,
    role,
    department,
    expiresAt
  };

  return emailService.sendInvitationEmail(emailData);
}

