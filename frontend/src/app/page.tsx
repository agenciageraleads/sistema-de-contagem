"use client";

import { useState, useEffect, useCallback } from "react";
import styles from "./page.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://contagem.vps.portaleletricos.com.br/api";

interface User {
  id: number;
  nome: string;
  login: string;
  role: "OPERADOR" | "SUPERVISOR" | "ADMIN";
}

interface ItemFila {
  id: number;
  codprod: number;
  descprod: string;
  marca: string;
  unidade: string;
  controle: string;
}

interface OpStats {
  nome: string;
  assertividade: number;
  total: number;
  metaIndividual: number;
}

interface SupervisorStats {
  resumo: {
    totalContado: number;
    divergenciasPendentes: number;
    valorEmFalta: number;
    valorEmSobra: number;
    assertividadeGlobal: number;
    metaGlobalDiaria: number;
    progressoGlobal: number;
  };
  rankingOperadores: OpStats[];
}

interface Divergencia {
  id: number;
  contagem: {
    codprod: number;
    codemp: number;
    codlocal: number;
    qtdContada: number;
    esperadoNoMomento: number;
    divergencia: number;
    divergenciaPercent: number;
    tipo: string;
    user: { nome: string };
    snapshot?: { descprod: string, marca?: string, controle?: string };
  };
  severidade: string;
  status: string;
  observacoes?: string;
  movimentacoes?: Array<{ TIPMOV: string; QTDNEG: number; DESCROPER: string; DTMOV: string; ORIGEM?: string }>;
  saldoAjustado?: number;
  createdAt: string;
}

export default function Home() {
  const [login, setLogin] = useState("");
  const [senha, setSenha] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState("");

  // Navegação Supervisor
  const [abaAtiva, setAbaAtiva] = useState<"dashboard" | "config" | "fila" | "usuarios" | "relatorios">("dashboard");

  // Estados Operador
  const [itemAtual, setItemAtual] = useState<ItemFila | null>(null);
  const [qtd, setQtd] = useState("");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [statsOperador, setStatsOperador] = useState<any>(null);
  const [metaBatida, setMetaBatida] = useState(false);
  const [showModalReportar, setShowModalReportar] = useState(false);
  const [motivoReporte, setMotivoReporte] = useState("");

  // Estados Supervisor
  const [supStats, setSupStats] = useState<SupervisorStats | null>(null);
  const [divergencias, setDivergencias] = useState<Divergencia[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [filaItems, setFilaItems] = useState<any[]>([]);
  const [metaGlobalEdit, setMetaGlobalEdit] = useState<number>(100);

  // Estados Admin (Usuários)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [usuarios, setUsuarios] = useState<any[]>([]);
  const [showModalUsuario, setShowModalUsuario] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [usuarioEdit, setUsuarioEdit] = useState<any>(null);
  const [formUsuario, setFormUsuario] = useState({ nome: "", login: "", senha: "", role: "OPERADOR" as any });


  // Login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login, senha }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message); return; }
      setToken(data.token);
      setUser(data.user);
    } catch { setError("Falha na sincronização"); } finally { setLoading(false); }
  };

  const handleResetCycle = async () => {
    if (!window.confirm("ATENÇÃO: Isso limpará todos os itens CONCLUÍDOS e REPORTADOS da fila para iniciar um novo ciclo do zero. Deseja continuar?")) return;

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/sankhya/reset-cycle`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` },
      });
      if (res.ok) {
        alert("Ciclo resetado com sucesso! A fila foi limpa e re-sincronizada.");
        carregarDadosSupervisor();
      }
    } catch { setError("Erro ao resetar ciclo"); } finally { setLoading(false); }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [itensReportados, setItensReportados] = useState<any[]>([]);
  const [lastSync, setLastSync] = useState<string>("");

  const handleLogout = () => {
    setUser(null);
    setItemAtual(null);
    setSupStats(null);
    window.location.reload(); // Força recarregamento para limpar estado visual
  };

  // --- LÓGICA OPERADOR ---
  const carregarStatsOperador = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/contagem/stats`, {
        headers: { "Authorization": `Bearer ${token}` },
      });
      const data = await res.json();
      setStatsOperador(data);
    } catch (e) { console.error(e); }
  }, [token]);

  const buscarProximo = async () => {
    setLoading(true); setQtd("");
    try {
      const res = await fetch(`${API_URL}/contagem/proximo`, {
        headers: { "Authorization": `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.id) {
        setItemAtual(data);
        setQtd(""); // Limpa o input para a próxima contagem
      }
      else setItemAtual(null);
    } catch { setError("Erro ao buscar item"); } finally { setLoading(false); }
  };

  const registrarContagem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemAtual) return;

    // Validação manual em vez de 'required' do HTML para evitar bloqueio de botões secundários
    if (!qtd || isNaN(Number(qtd)) || Number(qtd) < 0) {
      setError("Por favor, informe uma quantidade válida.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/contagem/registrar`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ filaId: itemAtual.id, qtd_contada: Number(qtd) }),
      });
      if (res.ok) {
        const statsRes = await fetch(`${API_URL}/contagem/stats`, {
          headers: { "Authorization": `Bearer ${token}` },
        });
        const newStats = await statsRes.json();
        setStatsOperador(newStats);
        // Celebração de meta: exibir apenas quando atinge pela 1ª vez
        if (newStats.concluido && !metaBatida) {
          setMetaBatida(true);
        }
        await buscarProximo();
      } else {
        const errorData = await res.json();
        setError(errorData.message || "Erro no registro");
      }
    } catch (err) {
      console.error(err);
      setError("Erro de comunicação com o servidor");
    } finally { setLoading(false); }
  };

  const handleNaoAchei = async () => {
    if (!itemAtual) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/contagem/nao-achei/${itemAtual.id}`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` },
      });
      if (res.ok) {
        await carregarStatsOperador();
        await buscarProximo();
      } else {
        setError("Erro ao processar 'Não Achei'");
      }
    } catch (err) {
      console.error(err);
      setError("Erro de rede");
    } finally { setLoading(false); }
  };

  const handleReportarProblema = () => {
    if (!itemAtual) return;
    setMotivoReporte("");
    setShowModalReportar(true);
  };

  const confirmarReporte = async () => {
    if (!itemAtual) return;
    if (!motivoReporte.trim()) {
      setError("Por favor, descreva o problema antes de enviar.");
      return;
    }
    setLoading(true);
    setShowModalReportar(false);
    try {
      const res = await fetch(`${API_URL}/contagem/reportar-problema/${itemAtual.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ motivo: motivoReporte }),
      });
      if (res.ok) {
        await carregarStatsOperador();
        await buscarProximo();
      } else {
        const errData = await res.json();
        setError(errData.message || "Erro ao reportar");
      }
    } catch {
      setError("Erro ao reportar");
    } finally {
      setLoading(false);
    }
  };

  // --- LÓGICA SUPERVISOR ---
  const carregarDadosSupervisor = useCallback(async () => {
    try {
      const [statsRes, divRes, filaRes, logRes, repRes] = await Promise.all([
        fetch(`${API_URL}/contagem/supervisor/stats`, { headers: { "Authorization": `Bearer ${token}` } }),
        fetch(`${API_URL}/contagem/divergencias`, { headers: { "Authorization": `Bearer ${token}` } }),
        fetch(`${API_URL}/contagem/fila`, { headers: { "Authorization": `Bearer ${token}` } }),
        fetch(`${API_URL}/sankhya/last-sync`, { headers: { "Authorization": `Bearer ${token}` } }),
        fetch(`${API_URL}/contagem/reportados`, { headers: { "Authorization": `Bearer ${token}` } }),
      ]);
      const sData = await statsRes.json();
      setSupStats(sData);
      setDivergencias(await divRes.json());
      setFilaItems(await filaRes.json());
      setItensReportados(await repRes.json());

      const lastSyncLog = await logRes.json();
      if (lastSyncLog && lastSyncLog.dataExecucao) {
        setLastSync(new Date(lastSyncLog.dataExecucao).toLocaleString('pt-BR'));
      }
      setMetaGlobalEdit(sData.resumo.metaGlobalDiaria);
    } catch (e) { console.error(e); }
  }, [token]);

  const tratarDivergencia = async (id: number, acao: 'APROVAR' | 'RECONTAR' | 'FINALIZAR_ANALISE') => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/contagem/divergencias/${id}/tratar`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ acao, observacao: `Tratado por ${user?.nome}` }),
      });
      if (res.ok) carregarDadosSupervisor();
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  const salvarMetaGlobal = async () => {
    try {
      await fetch(`${API_URL}/contagem/meta-global`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ valor: metaGlobalEdit }),
      });
      carregarDadosSupervisor();
    } catch (e) { console.error(e); }
  };

  // --- LÓGICA USUÁRIOS (Admin) ---
  const carregarUsuarios = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/auth/users`, {
        headers: { "Authorization": `Bearer ${token}` },
      });
      const data = await res.json();
      setUsuarios(data);
    } catch (e) { console.error(e); }
  }, [token]);

  const handleSalvarUsuario = async () => {
    setLoading(true);
    try {
      const url = usuarioEdit ? `${API_URL}/auth/users/${usuarioEdit.id}` : `${API_URL}/auth/register`;
      const method = usuarioEdit ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify(formUsuario),
      });
      if (res.ok) {
        setShowModalUsuario(false);
        carregarUsuarios();
      } else {
        const data = await res.json();
        setError(data.message || "Erro ao salvar usuário");
      }
    } catch { setError("Erro de rede"); } finally { setLoading(false); }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleInativarUsuario = async (u: any) => {
    if (!u.id) return;
    if (!window.confirm(`Deseja ${u.ativo ? 'inativar' : 'ativar'} o usuário ${u.nome}?`)) return;
    try {
      await fetch(`${API_URL}/auth/users/${u.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ ativo: !u.ativo }),
      });
      carregarUsuarios();
    } catch (e) { console.error(e); }
  };

  const handleResetSenha = async (id: number) => {
    const nova = window.prompt("Digite a nova senha (mínimo 4 caracteres):");
    if (!nova || nova.length < 4) return;
    try {
      const res = await fetch(`${API_URL}/auth/users/${id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ novaSenha: nova }),
      });
      if (res.ok) alert("Senha resetada com sucesso!");
    } catch (e) { console.error(e); }
  };

  // --- LÓGICA RELATÓRIOS ---
  const exportarRelatorio = async (tipo: 'divergencias' | 'produtividade') => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/contagem/export/${tipo}`, {
        headers: { "Authorization": `Bearer ${token}` },
      });
      const data = await res.json();
      if (!Array.isArray(data)) return;

      // Converter para CSV (simplificado)
      const headers = Object.keys(data[0]);
      const csvContent = [
        headers.join(","),
        ...data.map(row => headers.map(h => `"${row[h]}"`).join(","))
      ].join("\n");

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `relatorio-${tipo}-${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch { setError("Erro ao exportar"); } finally { setLoading(false); }
  };

  useEffect(() => {
    if (token && user?.role !== "OPERADOR") {
      carregarDadosSupervisor();
      if (abaAtiva === "usuarios") carregarUsuarios();
    }
  }, [token, user, abaAtiva, carregarDadosSupervisor, carregarUsuarios]);

  let content;

  if (!token) {
    content = (
      <div className={styles.loginContainer}>
        <div className={styles.logoArea}>
          <div className={styles.logoIcon}>📦</div>
          <h1 className={styles.title}>Contagem Cíclica</h1>
          <p className={styles.subtitle}>Portal Distribuidora</p>
        </div>
        <form onSubmit={handleLogin} className={styles.form}>
          <div className={styles.inputGroup}>
            <label className={styles.label}>Login</label>
            <input type="text" value={login} onChange={(e) => setLogin(e.target.value)} placeholder="Seu login" className={styles.input} required />
          </div>
          <div className={styles.inputGroup}>
            <label className={styles.label}>Senha</label>
            <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="Sua senha" className={styles.input} required />
          </div>
          {error && <div className={styles.errorMsg}>⚠️ {error}</div>}
          <button type="submit" className={styles.loginBtn} disabled={loading}>{loading ? "..." : "Entrar"}</button>
        </form>
        <div className={styles.testCreds}>
          <div className={styles.credsList}>
            <button onClick={() => { setLogin("admin"); setSenha("admin123"); }} className={styles.credBtn}>Admin</button>
            <button onClick={() => { setLogin("supervisor"); setSenha("super123"); }} className={styles.credBtn}>Supervisor</button>
            <button onClick={() => { setLogin("operador1"); setSenha("oper123"); }} className={styles.credBtn}>Operador</button>
          </div>
        </div>
      </div>
    );
  } else if (user?.role === "OPERADOR") {
    content = (
      <div className={styles.container}>
        <div className={styles.header}>
          <div className={styles.welcomeInfo}>
            <span className={styles.roleIcon}>👷</span>
            <div>
              <h1 className={styles.welcomeTitle}>Olá, {user.nome.split(' ')[0]}</h1>
              <span className={styles.roleBadge} data-role={user.role}>{user.role}</span>
            </div>
          </div>
          {statsOperador && (
            <div className={styles.topoMeta}>
              <span className={styles.metaLabel}>Meta: {statsOperador.total}/{statsOperador.metaDiaria}</span>
              <div className={styles.metaBar}><span style={{ width: `${statsOperador.progresso}%` }}></span></div>
              <span className={styles.metaValue}>{statsOperador.assertividade.toFixed(0)}%</span>
            </div>
          )}
          <button onClick={handleLogout} className={styles.smallLogout}>Sair</button>
        </div>

        {error && <div className={styles.errorMsg} style={{ margin: '10px 0' }}>⚠️ {error}</div>}

        {metaBatida && (
          <div className={styles.metaCelebration}>
            <span className={styles.celebrationEmoji}>🎉</span>
            <div>
              <strong>Parabéns! Meta diária atingida!</strong>
              <p>Continue contando para melhorar ainda mais o resultado.</p>
            </div>
            <button onClick={() => setMetaBatida(false)} className={styles.closeCelebration}>✕</button>
          </div>
        )}

        {!itemAtual ? (
          <div className={styles.startCard}>
            <button onClick={buscarProximo} className={styles.startBtn} disabled={loading}>
              {loading ? "Buscando..." : "🚀 Iniciar Próxima Contagem"}
            </button>
          </div>
        ) : (
          <div className={styles.countingCard}>
            <div className={styles.productHeader}>
              <div className={styles.productPhoto}>
                <img src={`http://portal.snk.ativy.com:40235/mge/Produto@IMAGEM@CODPROD=${itemAtual.codprod}.dbimage`}
                  onError={(e) => { (e.target as HTMLImageElement).src = `https://placehold.co/400x400/111827/0ea5e9?text=${itemAtual.codprod}` }}
                  alt={itemAtual.descprod} />
              </div>
              <div className={styles.productInfoArea}>
                <span className={styles.productBadge}>CÓD: {itemAtual.codprod}</span>
                <h2 className={styles.productTitle}>{itemAtual.descprod}</h2>
                <div className={styles.productMetadata}>
                  {itemAtual.marca && <span className={styles.metaTag}>Marca: {itemAtual.marca}</span>}
                  {itemAtual.controle && itemAtual.controle !== ' ' && <span className={styles.metaTag}>Lote/Controle: {itemAtual.controle}</span>}
                  {itemAtual.unidade && <span className={styles.metaTag}>Und: {itemAtual.unidade}</span>}
                </div>
              </div>
            </div>
            <form onSubmit={registrarContagem} className={styles.countForm}>
              <input
                type="number"
                inputMode="decimal"
                pattern="[0-9]*"
                step="0.001"
                value={qtd}
                onChange={(e) => setQtd(e.target.value)}
                className={styles.countInput}
                placeholder="0.000"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    registrarContagem(e as any);
                  }
                }}
              />
              <button type="submit" className={styles.confirmBtn} disabled={loading}>Confirmar Quantidade</button>
            </form>
            <div className={styles.actionButtonsSecondary}>
              <button type="button" onClick={handleNaoAchei} className={styles.naoAcheiBtnRed} disabled={loading}>Não Achei</button>
              <button type="button" onClick={handleReportarProblema} className={styles.reportBtn} disabled={loading}>⚠️ Reportar Erro</button>
            </div>
          </div>
        )}
      </div>
    );
  } else if (user?.role === "SUPERVISOR" || user?.role === "ADMIN") {
    content = (
      <div className={styles.supContainer}>
        <div className={styles.supHeader}>
          <div className={styles.welcomeInfo}>
            <span className={styles.roleIcon}>👔</span>
            <div>
              <h1 className={styles.welcomeTitle}>Controle de Logística</h1>
              <p className={styles.supSubtitle}>Monitoramento de Auditoria e Divergências</p>
            </div>
          </div>
          <div className={styles.supNav}>
            <div className={styles.navTabs}>
              <button onClick={() => setAbaAtiva("dashboard")} className={abaAtiva === "dashboard" ? styles.tabActive : styles.tab}>Dashboard</button>
              <button onClick={() => setAbaAtiva("fila")} className={abaAtiva === "fila" ? styles.tabActive : styles.tab}>Fila</button>
              <button onClick={() => setAbaAtiva("relatorios")} className={abaAtiva === "relatorios" ? styles.tabActive : styles.tab}>Relatórios</button>
              {user.role === "ADMIN" && (
                <button onClick={() => setAbaAtiva("usuarios")} className={abaAtiva === "usuarios" ? styles.tabActive : styles.tab}>Usuários</button>
              )}
              <button onClick={() => setAbaAtiva("config")} className={abaAtiva === "config" ? styles.tabActive : styles.tab}>⚙️</button>
            </div>
            <button onClick={() => carregarDadosSupervisor()} className={styles.syncBtn}>🔄 Sincronizar</button>
            <div className={styles.userProfile}>
              <span className={styles.userNameHeader}>{user.nome}</span>
              <button onClick={handleLogout} className={styles.smallLogout}>Sair</button>
            </div>
          </div>
        </div>

        {abaAtiva === "dashboard" ? (
          <>
            {supStats && (
              <div className={styles.globalProgressCard}>
                <div className={styles.globalProgressHeader}>
                  <h2 className={styles.globalProgressTitle}>Progresso Global</h2>
                  <span className={styles.globalProgressLabel}>{supStats.resumo.totalContado} / {supStats.resumo.metaGlobalDiaria}</span>
                </div>
                <div className={styles.globalProgressBar}><span style={{ width: `${Math.min(supStats.resumo.progressoGlobal, 100)}%` }}></span></div>
              </div>
            )}

            {supStats && (
              <div className={styles.kpiGrid}>
                <div className={styles.kpiCard} data-type="alert">
                  <span className={styles.kpiLabel}>Divergências</span>
                  <span className={styles.kpiValue}>{supStats.resumo.divergenciasPendentes}</span>
                </div>
                <div className={styles.kpiCard} data-type="error">
                  <span className={styles.kpiLabel}>Valor Falta</span>
                  <span className={styles.kpiValue}>R$ {supStats.resumo.valorEmFalta.toLocaleString()}</span>
                </div>
                <div className={styles.kpiCard} data-type="success">
                  <span className={styles.kpiLabel}>Valor Sobra</span>
                  <span className={styles.kpiValue}>R$ {supStats.resumo.valorEmSobra.toLocaleString()}</span>
                </div>
                <div className={styles.kpiCard}>
                  <span className={styles.kpiLabel}>Assertividade</span>
                  <span className={styles.kpiValue}>{supStats.resumo.assertividadeGlobal.toFixed(1)}%</span>
                </div>
              </div>
            )}

            <div className={styles.supContent}>
              <div className={styles.divPanel}>
                <h2 className={styles.panelTitle}>Divergências Pendentes</h2>
                <div className={styles.divTable}>
                  <div className={styles.tableHeader}>
                    <span>Produto / Operador</span>
                    <span>Esperado</span>
                    <span>Contado</span>
                    <span>Dif / %</span>
                    <span>Ações</span>
                  </div>
                  {divergencias.length === 0 ? (
                    <div className={styles.emptyTable}>Tudo limpo! ✅</div>
                  ) : divergencias.map(d => (
                    <div key={d.id} className={styles.tableRow}>
                      <div className={styles.prodCol}>
                        <span className={styles.prodName}>{d.contagem.snapshot?.descprod || `Cód: ${d.contagem.codprod}`}</span>
                        <span className={styles.userName}>{d.contagem.user.nome}</span>
                      </div>
                      <span className={styles.numCol}>{Number(d.contagem.esperadoNoMomento).toFixed(2)}</span>
                      <span className={styles.numCol}>{Number(d.contagem.qtdContada).toFixed(2)}</span>
                      <div className={styles.diffCol}>
                        <span className={d.contagem.divergencia < 0 ? styles.textError : styles.textSuccess}>
                          {d.contagem.divergencia > 0 ? '+' : ''}{Number(d.contagem.divergencia).toFixed(2)}
                        </span>
                        <span className={styles.percVal}>{Number(d.contagem.divergenciaPercent).toFixed(1)}%</span>
                      </div>
                      <div className={styles.actions}>
                        <button onClick={() => tratarDivergencia(d.id, "APROVAR")} className={styles.btnApprove}>✓</button>
                        <button onClick={() => tratarDivergencia(d.id, "RECONTAR")} className={styles.btnRecount}>🔄</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className={styles.rankingPanel}>
                <h3 className={styles.panelTitle}>Ranking Operadores</h3>
                <div className={styles.rankingList}>
                  {supStats?.rankingOperadores.map((op, idx) => (
                    <div key={idx} className={styles.rankingItem}>
                      <span className={styles.rankName}>{op.nome}</span>
                      <div className={styles.rankBarArea}>
                        <div className={styles.rankBar}><span style={{ width: `${op.assertividade}%` }}></span></div>
                        <span className={styles.rankVal}>{op.assertividade.toFixed(0)}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        ) : abaAtiva === "fila" ? (
          <div className={styles.divPanel}>
            <h3 className={styles.panelTitle}>Fila de Contagem ({filaItems.length})</h3>
            <div className={styles.divTable}>
              {filaItems.map(f => (
                <div key={f.id} className={styles.tableRow}>
                  <div className={styles.prodCol}>
                    <span className={styles.prodName}>{f.descprod}</span>
                    <span className={styles.userName}>Cód: {f.codprod}</span>
                  </div>
                  <span className={styles.tagCol}>{f.codlocal}</span>
                  <span className={styles.statusBadge} data-status={f.status}>{f.status}</span>
                </div>
              ))}
            </div>
          </div>
        ) : abaAtiva === "usuarios" ? (
          <div className={styles.divPanel}>
            <div className={styles.panelHeader}>
              <h3 className={styles.panelTitle}>Gestão de Usuários</h3>
              <button className={styles.confirmBtnSmall} onClick={() => { setUsuarioEdit(null); setFormUsuario({ nome: "", login: "", senha: "", role: "OPERADOR" }); setShowModalUsuario(true); }}>+ Novo</button>
            </div>
            <div className={styles.divTable}>
              <div className={styles.tableHeader}>
                <span>Nome</span>
                <span>Login</span>
                <span>Cargo</span>
                <span>Status</span>
                <span>Ações</span>
              </div>
              {usuarios.map(u => (
                <div key={u.id} className={styles.tableRow}>
                  <span className={styles.prodName}>{u.nome}</span>
                  <span>{u.login}</span>
                  <span className={styles.roleBadge} data-role={u.role}>{u.role}</span>
                  <span style={{ color: u.ativo ? '#10b981' : '#ef4444' }}>{u.ativo ? 'Ativo' : 'Inativo'}</span>
                  <div className={styles.actions}>
                    <button onClick={() => handleResetSenha(u.id)} title="Reset Senha">🔑</button>
                    <button onClick={() => { setUsuarioEdit(u); setFormUsuario({ nome: u.nome, login: u.login, senha: "", role: u.role }); setShowModalUsuario(true); }} title="Editar">✏️</button>
                    <button onClick={() => handleInativarUsuario(u)} title={u.ativo ? 'Inativar' : 'Ativar'}>{u.ativo ? '🚫' : '✅'}</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : abaAtiva === "relatorios" ? (
          <div className={styles.configArea}>
            <h2 className={styles.panelTitle}>Central de Relatórios</h2>
            <div className={styles.kpiGrid}>
              <div className={styles.configCard} style={{ cursor: 'pointer' }} onClick={() => exportarRelatorio('divergencias')}>
                <h3 className={styles.configTitle}>📦 Divergências</h3>
                <p className={styles.configSubtitle}>Exporta histórico de erros e resoluções.</p>
                <button className={styles.confirmBtnSmall} style={{ marginTop: '16px', display: 'block', width: '100%' }}>Download CSV</button>
              </div>
              <div className={styles.configCard} style={{ cursor: 'pointer' }} onClick={() => exportarRelatorio('produtividade')}>
                <h3 className={styles.configTitle}>👷 Produtividade</h3>
                <p className={styles.configSubtitle}>Contagens realizadas e tempos por operador.</p>
                <button className={styles.confirmBtnSmall} style={{ marginTop: '16px', display: 'block', width: '100%' }}>Download CSV</button>
              </div>
            </div>
          </div>
        ) : (
          <div className={styles.configArea}>
            <h2 className={styles.panelTitle}>Configurações</h2>
            <div className={styles.configCard}>
              <h3 className={styles.configTitle}>Meta Diária Global</h3>
              <div className={styles.configAction}>
                <input type="number" value={metaGlobalEdit} onChange={e => setMetaGlobalEdit(Number(e.target.value))} className={styles.input} />
                <button onClick={salvarMetaGlobal} className={styles.confirmBtnSmall}>Salvar</button>
              </div>
              <button onClick={handleResetCycle} className={styles.resetBtn} style={{ marginTop: '20px' }}>🗑️ Encerrar Ciclo Atual</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <main className={user?.role === "OPERADOR" || !token ? styles.main : styles.mainFull}>
      {content}

      {/* Modal de Reporte */}
      {showModalReportar && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <h3>⚠️ Reportar Problema</h3>
            <textarea
              className={styles.modalTextarea}
              placeholder="Descreva o problema..."
              value={motivoReporte}
              onChange={(e) => setMotivoReporte(e.target.value)}
            />
            <div className={styles.modalActions}>
              <button onClick={() => setShowModalReportar(false)}>Cancelar</button>
              <button onClick={confirmarReporte} className={styles.saveBtn}>Enviar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Usuário */}
      {showModalUsuario && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <h3>{usuarioEdit ? 'Editar Usuário' : 'Novo Usuário'}</h3>
            <div className={styles.form}>
              <input type="text" placeholder="Nome Completo" value={formUsuario.nome} onChange={e => setFormUsuario({ ...formUsuario, nome: e.target.value })} className={styles.input} />
              {!usuarioEdit && (
                <>
                  <input type="text" placeholder="Login" value={formUsuario.login} onChange={e => setFormUsuario({ ...formUsuario, login: e.target.value })} className={styles.input} />
                  <input type="password" placeholder="Senha" value={formUsuario.senha} onChange={e => setFormUsuario({ ...formUsuario, senha: e.target.value })} className={styles.input} />
                </>
              )}
              <select value={formUsuario.role} onChange={e => setFormUsuario({ ...formUsuario, role: e.target.value as any })} className={styles.input}>
                <option value="OPERADOR">Operador</option>
                <option value="SUPERVISOR">Supervisor</option>
                <option value="ADMIN">Administrador</option>
              </select>
            </div>
            {error && <p className={styles.errorMsg}>{error}</p>}
            <div className={styles.modalActions}>
              <button onClick={() => setShowModalUsuario(false)}>Cancelar</button>
              <button onClick={handleSalvarUsuario} className={styles.saveBtn}>Salvar</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

