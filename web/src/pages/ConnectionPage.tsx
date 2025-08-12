import React, { useState, useEffect, useCallback, useMemo } from "react";
import "@vscode/codicons/dist/codicon.css";

type ConnectionDraft = {
  id: string;
  name: string;
  driver: "mysql";
  host: string;
  port: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: { mode: "disable" | "require" | "verify-ca" | "verify-full"; caPath?: string };
  ssh?: { host: string; user: string; keyPath?: string; passphrase?: string; port?: number };
};

type Variable = {
  id: string;
  value: string;
};

const vscode: { postMessage: (msg: any) => void } = 
  (window as any).acquireVsCodeApi?.() || { postMessage: (_: unknown) => {} };

// Helper function to resolve variables in a string
const resolveVariables = (text: string, variables: Record<string, string>): string => {
  if (!text) return text;
  return text.replace(/\$\{([^}]+)\}/g, (match, varName) => {
    return variables[varName] || match;
  });
};

// Helper function to check if a string contains variables
const containsVariables = (text: string): boolean => {
  return /\$\{[^}]+\}/.test(text || "");
};

// Variable-enabled input component
interface VariableInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
  variables: Record<string, string>;
  style?: React.CSSProperties;
  showPasswordToggle?: boolean;
  showPassword?: boolean;
  onTogglePassword?: () => void;
}

const VariableInput: React.FC<VariableInputProps> = ({ 
  value, onChange, placeholder, type = "text", disabled, variables, style,
  showPasswordToggle, showPassword, onTogglePassword
}) => {
  const resolvedValue = useMemo(() => {
    const resolved = resolveVariables(value || "", variables);
    console.log(`Variable resolution: "${value}" -> "${resolved}"`, { variables });
    return resolved;
  }, [value, variables]);
  const hasVariables = useMemo(() => {
    // Only check for variables in actual values, not empty/null values
    return value && value.trim() !== "" && containsVariables(value);
  }, [value]);
  
  const inputType = showPasswordToggle ? (showPassword ? "text" : "password") : type;
  const rightPadding = (hasVariables ? 32 : 0) + (showPasswordToggle ? 32 : 0) + 8;
  
  return (
    <div style={{ position: "relative", width: "100%", minWidth: 0 }}>
      <input
        type={inputType}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder || "plain text or ${varName}"}
        disabled={disabled}
        style={{
          ...style,
          width: "100%",
          boxSizing: "border-box",
          paddingRight: `${rightPadding}px`,
          paddingLeft: "8px",
          backgroundColor: hasVariables ? "var(--vscode-inputValidation-infoBackground)" : "var(--vscode-input-background)",
          border: hasVariables ? "1px solid var(--vscode-inputValidation-infoBorder)" : "1px solid var(--vscode-input-border)"
        }}
      />
      
      {/* Variable indicator */}
      {hasVariables && (
        <div
          style={{
            position: "absolute",
            right: showPasswordToggle ? "36px" : "10px",
            top: "50%",
            transform: "translateY(-50%)",
            color: "var(--vscode-descriptionForeground)",
            fontSize: "12px",
            pointerEvents: "none",
            zIndex: 1,
            width: "16px",
            height: "16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center"
          }}
          title={`Resolved: ${resolvedValue}`}
        >
          <i className="codicon codicon-symbol-variable" />
        </div>
      )}
      
      {/* Password toggle button */}
      {showPasswordToggle && onTogglePassword && (
        <button
          type="button"
          onClick={onTogglePassword}
          style={{
            position: "absolute",
            right: "6px",
            top: "50%",
            transform: "translateY(-50%)",
            background: "transparent",
            border: "none",
            color: "var(--vscode-foreground)",
            cursor: "pointer",
            padding: "2px",
            width: "20px",
            height: "20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1
          }}
        >
          <i className={`codicon ${showPassword ? "codicon-eye-closed" : "codicon-eye"}`} />
        </button>
      )}
    </div>
  );
};

export function ConnectionPage() {
  const [draft, setDraft] = useState<ConnectionDraft>({
    id: String(Date.now()),
    name: "",
    driver: "mysql",
    host: "",
    port: 3306,
    database: "",
    user: "",
    password: "",
    ssl: { mode: "disable" },
    ssh: { host: "", user: "", keyPath: "", passphrase: "", port: 22 },
  });
  
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [maskedVars, setMaskedVars] = useState<Record<string, string>>({});
  const [variables, setVariables] = useState<Variable[]>([]);
  const [showPassword, setShowPassword] = useState(false);

  const setField = useCallback((key: keyof ConnectionDraft, value: any) => {
    setDraft(prev => ({ ...prev, [key]: value }));
  }, []);

  const setNestedField = useCallback((parent: 'ssl' | 'ssh', key: string, value: any) => {
    setDraft(prev => ({
      ...prev,
      [parent]: { ...(prev[parent] || {}), [key]: value }
    }));
  }, []);

  useEffect(() => {
    const onMessage = (e: MessageEvent<any>) => {
      const msg = e.data;
      switch (msg.type) {
        case "variablesPreview":
          console.log("Received variablesPreview:", msg.masked);
        setMaskedVars(msg.masked || {});
          break;
        case "variablesList":
          console.log("Received variablesList:", msg.items);
          setVariables(msg.items || []);
          break;
        case "variablesSaved":
          setStatus("Variables saved successfully");
          vscode.postMessage({ type: "variablesList" });
          break;
        case "variableDeleted":
          setStatus("Variable deleted");
          vscode.postMessage({ type: "variablesList" });
          break;
        case "testResult":
          setStatus(msg.ok ? `✓ ${msg.message}` : `✗ Test failed: ${msg.message}`);
        setError(msg.ok ? "" : String(msg.message || ""));
          break;
        case "saved":
          setStatus("Connection saved successfully");
          console.log("Connection saved successfully");
          break;
        case "initDefaults":
          if (msg.defaults) {
            console.log("Received initDefaults:", msg.defaults);
            console.log("Current draft before merge:", draft);
            const newDraft = { ...draft, ...msg.defaults };
            console.log("New draft after merge:", newDraft);
            setDraft(newDraft);
            setStatus("Connection data loaded");
          }
          break;
        case "error":
          setError(String(msg.message || "Error occurred"));
          console.error("Connection error:", msg.message);
          break;
      }
    };

    window.addEventListener("message", onMessage as any);
    
    // Initialize data - request variables and then explicitly ask for defaults
    console.log("Initializing connection page...");
    vscode.postMessage({ type: "variablesPreview" });
    vscode.postMessage({ type: "variablesList" });
    vscode.postMessage({ type: "requestDefaults" });
    
    return () => window.removeEventListener("message", onMessage as any);
  }, []);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    
    // Validate required fields
    if (!draft.name || !draft.name.trim()) {
      setError("Connection name is required");
      return;
    }
    
    if (!draft.host || !draft.host.trim()) {
      setError("Host is required");
      return;
    }
    
    if (!draft.port || draft.port <= 0) {
      setError("Valid port number is required");
      return;
    }
    
    setStatus("Saving connection...");
    
    // Debug log to see what we're sending
    console.log("Saving connection draft:", draft);
    
    vscode.postMessage({ type: "save", draft });
  }, [draft]);

  const handleTest = useCallback(() => {
    setError("");
    setStatus("Testing connection...");
    vscode.postMessage({ type: "test", draft });
  }, [draft]);

  const handleCancel = useCallback(() => {
    vscode.postMessage({ type: "cancel" });
  }, []);

  const addVariable = useCallback(() => {
    const newVar: Variable = {
      id: "",
      value: ""
    };
    setVariables(prev => [...prev, newVar]);
  }, []);

  const updateVariable = useCallback((oldId: string, newId: string, value: string) => {
    setVariables(prev => prev.map(v => v.id === oldId ? { id: newId, value } : v));
  }, []);

  const updateVariableValue = useCallback((id: string, value: string) => {
    setVariables(prev => prev.map(v => v.id === id ? { ...v, value } : v));
  }, []);

  const updateVariableName = useCallback((index: number, newId: string) => {
    setVariables(prev => prev.map((v, i) => i === index ? { ...v, id: newId } : v));
  }, []);

  const updateVariableNameByOldId = useCallback((oldId: string, newId: string) => {
    setVariables(prev => prev.map(v => v.id === oldId ? { ...v, id: newId } : v));
  }, []);

  const deleteVariable = useCallback((id: string) => {
    vscode.postMessage({ type: "variableDelete", id });
  }, []);

  const saveAllVariables = useCallback(() => {
    // Only save variables with valid names (non-empty, no invalid chars, no duplicates)
    const validVariables = variables.filter(v => {
      const hasValidName = v.id && v.id.trim() !== "" && /^[a-zA-Z0-9_]+$/.test(v.id);
      const isUnique = variables.filter(other => other.id === v.id).length === 1;
      return hasValidName && isUnique;
    });
    
    vscode.postMessage({ type: "variablesBulkSave", items: validVariables });
  }, [variables]);

  return (
    <div style={{ 
      minHeight: "100vh", 
      backgroundColor: "var(--vscode-editor-background)", 
      color: "var(--vscode-foreground)",
      fontFamily: "var(--vscode-font-family)",
      fontSize: "var(--vscode-font-size)"
    }}>
      <div style={{ padding: "20px", maxWidth: "800px", margin: "0 auto" }}>
        <header style={{ marginBottom: "24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h1 style={{ 
            margin: 0, 
            fontSize: "24px", 
            fontWeight: "600",
            display: "flex",
            alignItems: "center",
            gap: "8px"
          }}>
            <i className="codicon codicon-plug" />
            New Connection
          </h1>
          <button
            type="button"
            onClick={() => vscode.postMessage({ type: "openVariables" })}
            title="Manage Variables"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 10px",
              backgroundColor: "var(--vscode-button-secondaryBackground)",
              color: "var(--vscode-button-secondaryForeground)",
              border: "1px solid var(--vscode-button-border)",
              borderRadius: "4px",
              cursor: "pointer"
            }}
          >
            <i className="codicon codicon-symbol-variable" />
            Variables
          </button>
        </header>

      {error && (
          <div style={{ 
            padding: "12px", 
            marginBottom: "16px",
            backgroundColor: "var(--vscode-inputValidation-errorBackground)",
            border: "1px solid var(--vscode-inputValidation-errorBorder)",
            borderRadius: "4px",
            color: "var(--vscode-errorForeground)",
            display: "flex",
            alignItems: "center",
            gap: "8px"
          }}>
            <i className="codicon codicon-error" />
            {error}
        </div>
      )}

      {status && !error && (
          <div style={{ 
            padding: "12px", 
            marginBottom: "16px",
            backgroundColor: "var(--vscode-inputValidation-infoBackground)",
            border: "1px solid var(--vscode-inputValidation-infoBorder)",
            borderRadius: "4px",
            color: "var(--vscode-foreground)",
            display: "flex",
            alignItems: "center",
            gap: "8px"
          }}>
            <i className="codicon codicon-info" />
            {status}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {/* Basic Connection Settings */}
          <section>
            <h3 style={{ margin: "0 0 16px 0", fontSize: "16px", fontWeight: "600" }}>
              Connection Details
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ fontWeight: "500" }}>Name *</span>
                <VariableInput
                  value={draft.name}
                  onChange={value => setField("name", value)}
                  placeholder="Connection name or ${connectionName}"
                  variables={maskedVars}
                  style={{
                    borderRadius: "4px",
                    color: "var(--vscode-input-foreground)",
                    height: "32px"
                  }}
                />
          </label>
              
              <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ fontWeight: "500" }}>Driver</span>
                <select 
                  value={draft.driver} 
                  onChange={() => {}} 
                  style={{ 
                    padding: "8px", 
                    backgroundColor: "var(--vscode-input-background)",
                    border: "1px solid var(--vscode-input-border)",
                    borderRadius: "4px",
                    color: "var(--vscode-input-foreground)"
                  }}
                >
                  <option value="mysql">MySQL</option>
                </select>
          </label>

              <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ fontWeight: "500" }}>Host *</span>
                <VariableInput
                  value={draft.host}
                  onChange={value => setField("host", value)}
                  placeholder="localhost or ${dbHost}"
                  variables={maskedVars}
                  style={{
                    borderRadius: "4px",
                    color: "var(--vscode-input-foreground)",
                    height: "32px"
                  }}
                />
          </label>

              <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ fontWeight: "500" }}>Port *</span>
                <VariableInput
                  value={String(draft.port)}
                  onChange={value => setField("port", Number(value) || 3306)}
                  placeholder="3306 or ${dbPort}"
                  type="number"
                  variables={maskedVars}
                  style={{
                    borderRadius: "4px",
                    color: "var(--vscode-input-foreground)",
                    height: "32px"
                  }}
                />
          </label>

              <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ fontWeight: "500" }}>Database</span>
                <VariableInput
                  value={draft.database || ""}
                  onChange={value => setField("database", value)}
                  placeholder="database name or ${dbName}"
                  variables={maskedVars}
                  style={{
                    borderRadius: "4px",
                    color: "var(--vscode-input-foreground)",
                    height: "32px"
                  }}
                />
          </label>

              <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ fontWeight: "500" }}>User</span>
                <VariableInput
                  value={draft.user || ""}
                  onChange={value => setField("user", value)}
                  placeholder="username or ${dbUser}"
                  variables={maskedVars}
                  style={{
                    borderRadius: "4px",
                    color: "var(--vscode-input-foreground)",
                    height: "32px"
                  }}
                />
          </label>

              <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ fontWeight: "500" }}>Password</span>
                <VariableInput
                  value={draft.password || ""}
                  onChange={value => setField("password", value)}
                  placeholder="password or ${dbPassword}"
                  variables={maskedVars}
                  showPasswordToggle={true}
                  showPassword={showPassword}
                  onTogglePassword={() => setShowPassword(!showPassword)}
                  style={{
                    borderRadius: "4px",
                    color: "var(--vscode-input-foreground)",
                    height: "32px"
                  }}
                />
          </label>
            </div>
          </section>

          {/* SSL Settings */}
          <section>
            <h3 style={{ margin: "0 0 16px 0", fontSize: "16px", fontWeight: "600" }}>
              SSL Configuration
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ fontWeight: "500" }}>SSL Mode</span>
                <select 
                  value={draft.ssl?.mode || "disable"} 
                  onChange={e => setNestedField("ssl", "mode", e.target.value)}
                  style={{ 
                    padding: "8px", 
                    backgroundColor: "var(--vscode-input-background)",
                    border: "1px solid var(--vscode-input-border)",
                    borderRadius: "4px",
                    color: "var(--vscode-input-foreground)"
                  }}
                >
              <option value="disable">Disable</option>
              <option value="require">Require</option>
              <option value="verify-ca">Verify CA</option>
              <option value="verify-full">Verify Full</option>
            </select>
          </label>

              <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ fontWeight: "500" }}>SSL CA Path</span>
                <VariableInput
                  value={draft.ssl?.caPath || ""}
                  onChange={value => setNestedField("ssl", "caPath", value)}
                  placeholder="/path/to/ca.pem or ${sslCertPath}"
                  disabled={draft.ssl?.mode === "disable"}
                  variables={maskedVars}
                  style={{
                    padding: "8px",
                    borderRadius: "4px",
                    color: "var(--vscode-input-foreground)",
                    width: "100%",
                    opacity: draft.ssl?.mode === "disable" ? 0.5 : 1
                  }}
                />
          </label>
        </div>
          </section>

          {/* SSH Tunnel */}
          <details style={{ border: "1px solid var(--vscode-input-border)", borderRadius: "4px" }}>
            <summary style={{ 
              padding: "12px", 
              cursor: "pointer", 
              fontWeight: "600",
              backgroundColor: "var(--vscode-editorWidget-background)"
            }}>
              <i className="codicon codicon-server" style={{ marginRight: "8px" }} />
              SSH Tunnel (optional)
            </summary>
            <div style={{ padding: "16px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ fontWeight: "500" }}>SSH Host</span>
                <VariableInput
                  value={draft.ssh?.host || ""}
                  onChange={value => setNestedField("ssh", "host", value)}
                  placeholder="ssh.example.com or ${sshHost}"
                  variables={maskedVars}
                  style={{
                    borderRadius: "4px",
                    color: "var(--vscode-input-foreground)",
                    height: "32px"
                  }}
                />
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ fontWeight: "500" }}>SSH User</span>
                <VariableInput
                  value={draft.ssh?.user || ""}
                  onChange={value => setNestedField("ssh", "user", value)}
                  placeholder="username or ${sshUser}"
                  variables={maskedVars}
                  style={{
                    borderRadius: "4px",
                    color: "var(--vscode-input-foreground)",
                    height: "32px"
                  }}
                />
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ fontWeight: "500" }}>SSH Port</span>
                <VariableInput
                  value={String(draft.ssh?.port || 22)}
                  onChange={value => setNestedField("ssh", "port", Number(value) || 22)}
                  placeholder="22 or ${sshPort}"
                  type="number"
                  variables={maskedVars}
                  style={{
                    borderRadius: "4px",
                    color: "var(--vscode-input-foreground)",
                    height: "32px"
                  }}
                />
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ fontWeight: "500" }}>SSH Key Path</span>
                <VariableInput
                  value={draft.ssh?.keyPath || ""}
                  onChange={value => setNestedField("ssh", "keyPath", value)}
                  placeholder="~/.ssh/id_rsa or ${sshKeyPath}"
                  variables={maskedVars}
                  style={{
                    borderRadius: "4px",
                    color: "var(--vscode-input-foreground)",
                    height: "32px"
                  }}
                />
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: "4px", gridColumn: "span 2" }}>
                <span style={{ fontWeight: "500" }}>SSH Passphrase</span>
                <VariableInput
                  value={draft.ssh?.passphrase || ""}
                  onChange={value => setNestedField("ssh", "passphrase", value)}
                  placeholder="passphrase or ${sshPassphrase}"
                  type="password"
                  variables={maskedVars}
                  style={{
                    borderRadius: "4px",
                    color: "var(--vscode-input-foreground)",
                    height: "32px"
                  }}
                />
              </label>
          </div>
        </details>

          {/* Action Buttons */}
          <div style={{ 
            display: "flex", 
            gap: "12px", 
            paddingTop: "16px", 
            borderTop: "1px solid var(--vscode-input-border)"
          }}>
            <button
              type="button"
              onClick={handleTest}
              style={{
                padding: "10px 16px",
                backgroundColor: "var(--vscode-button-secondaryBackground)",
                border: "1px solid var(--vscode-button-border)",
                borderRadius: "4px",
                color: "var(--vscode-button-secondaryForeground)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "14px"
              }}
            >
              <i className="codicon codicon-debug-start" />
              Test Connection
            </button>
            
            <button
              type="submit"
              style={{
                padding: "10px 16px",
                backgroundColor: "var(--vscode-button-background)",
                border: "none",
                borderRadius: "4px",
                color: "var(--vscode-button-foreground)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "14px",
                fontWeight: "500"
              }}
            >
              <i className="codicon codicon-save" />
              Save Connection
            </button>
            
            <button
              type="button"
              onClick={handleCancel}
              style={{
                padding: "10px 16px",
                backgroundColor: "transparent",
                border: "1px solid var(--vscode-button-border)",
                borderRadius: "4px",
                color: "var(--vscode-foreground)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "14px"
              }}
            >
              <i className="codicon codicon-close" />
              Cancel
            </button>
        </div>
      </form>
      </div>
    </div>
  );
}


