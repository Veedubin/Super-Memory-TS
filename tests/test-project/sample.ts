/**
 * Sample TypeScript file for testing
 */

export interface User {
  id: string;
  name: string;
  email: string;
}

export class UserService {
  private users: Map<string, User> = new Map();

  constructor() {
    this.initialize();
  }

  private initialize(): void {
    console.log('Initializing UserService');
  }

  public async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  public async createUser(name: string, email: string): Promise<User> {
    const user: User = {
      id: crypto.randomUUID(),
      name,
      email,
    };
    this.users.set(user.id, user);
    return user;
  }

  public async updateUser(id: string, updates: Partial<User>): Promise<User | undefined> {
    const user = this.users.get(id);
    if (!user) return undefined;
    
    const updatedUser = { ...user, ...updates };
    this.users.set(id, updatedUser);
    return updatedUser;
  }

  public async deleteUser(id: string): Promise<boolean> {
    return this.users.delete(id);
  }
}

export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
