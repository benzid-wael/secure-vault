export class Vault {
  constructor({
    name,
    version = '1.0',
    created = new Date().toISOString(),
    lastPasswordChange = new Date().toISOString(),
    entries = [],
    passwordHistory = [],
    settings = {},
    isDefault = false,
  } = {}) {
    this.name = name;
    this.version = version;
    this.created = created;
    this.lastPasswordChange = lastPasswordChange;
    this.entries = entries;
    this.passwordHistory = passwordHistory;
    this.settings = this._validateSettings(settings);
    this.isDefault = isDefault;
  }

  _validateSettings(settings) {
    return {
      enforcePasswordChange: settings.enforcePasswordChange ?? false,
      passwordChangeWarningDays: Math.max(
        1,
        settings.passwordChangeWarningDays ?? 90
      ),
      preventPasswordReuse: settings.preventPasswordReuse ?? true,
      maxPasswordHistory: Math.max(1, settings.maxPasswordHistory ?? 3),
      ...settings,
    };
  }

  updateSettings(newSettings) {
    this.settings = this._validateSettings({
      ...this.settings,
      ...newSettings,
    });
  }

  addPasswordToHistory(passwordHash) {
    this.passwordHistory.unshift({
      changedAt: this.lastPasswordChange,
      passwordHash,
    });

    // Keep only the specified number of password history entries
    this.passwordHistory = this.passwordHistory.slice(
      0,
      this.settings.maxPasswordHistory
    );
  }

  checkPasswordReuse(passwordHash) {
    if (!this.settings.preventPasswordReuse) {
      return false;
    }

    return this.passwordHistory.some(
      (entry) => entry.passwordHash === passwordHash
    );
  }

  updateLastPasswordChange() {
    this.lastPasswordChange = new Date().toISOString();
  }

  toJSON() {
    return {
      version: this.version,
      created: this.created,
      lastPasswordChange: this.lastPasswordChange,
      entries: this.entries,
      passwordHistory: this.passwordHistory,
      settings: this.settings,
      isDefault: this.isDefault,
    };
  }

  static fromJSON(data, name) {
    return new Vault({
      name,
      ...data,
    });
  }
}
