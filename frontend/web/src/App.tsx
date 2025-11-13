import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { JSX, useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface GeneticScreeningData {
  id: number;
  name: string;
  diseaseCode: string;
  riskLevel: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
  encryptedValueHandle?: string;
}

interface RiskAnalysis {
  riskScore: number;
  probability: number;
  severity: number;
  confidence: number;
  preventionScore: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [screenings, setScreenings] = useState<GeneticScreeningData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingScreening, setCreatingScreening] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newScreeningData, setNewScreeningData] = useState({ name: "", diseaseCode: "", riskLevel: "" });
  const [selectedScreening, setSelectedScreening] = useState<GeneticScreeningData | null>(null);
  const [decryptedData, setDecryptedData] = useState<{ riskScore: number | null; probability: number | null }>({ riskScore: null, probability: null });
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [showFAQ, setShowFAQ] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting} = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) {
        return;
      }
      
      if (isInitialized) {
        return;
      }
      
      if (fhevmInitializing) {
        return;
      }
      
      try {
        setFhevmInitializing(true);
        console.log('Initializing FHEVM after wallet connection...');
        await initialize();
        console.log('FHEVM initialized successfully');
      } catch (error) {
        console.error('Failed to initialize FHEVM:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed. Please check your wallet connection." 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const screeningsList: GeneticScreeningData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          screeningsList.push({
            id: parseInt(businessId.replace('screening-', '')) || Date.now(),
            name: businessData.name,
            diseaseCode: businessId,
            riskLevel: businessId,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setScreenings(screeningsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createScreening = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingScreening(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating genetic screening with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const riskValue = parseInt(newScreeningData.riskLevel) || 0;
      const businessId = `screening-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, riskValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newScreeningData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newScreeningData.diseaseCode) || 0,
        0,
        "Genetic Disease Screening"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Screening created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewScreeningData({ name: "", diseaseCode: "", riskLevel: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingScreening(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const analyzeRisk = (screening: GeneticScreeningData, decryptedRisk: number | null): RiskAnalysis => {
    const risk = screening.isVerified ? (screening.decryptedValue || 0) : (decryptedRisk || screening.publicValue1 || 5);
    const diseaseCode = screening.publicValue1 || 5;
    
    const baseRisk = Math.min(100, Math.round((risk * 0.7 + diseaseCode * 0.3) * 10));
    const timeFactor = Math.max(0.7, Math.min(1.3, 1 - (Date.now()/1000 - screening.timestamp) / (60 * 60 * 24 * 30)));
    const riskScore = Math.round(baseRisk * timeFactor);
    
    const probability = Math.round(risk * 8 + Math.log(diseaseCode + 1) * 2);
    const severity = Math.round(diseaseCode * 6 + risk * 4);
    
    const confidence = Math.max(60, Math.min(95, 100 - (risk * 0.1 + diseaseCode * 2)));
    const preventionScore = Math.min(95, Math.round((100 - risk) * 0.8 + diseaseCode * 0.2));

    return {
      riskScore,
      probability,
      severity,
      confidence,
      preventionScore
    };
  };

  const renderStatistics = () => {
    const totalScreenings = screenings.length;
    const verifiedScreenings = screenings.filter(s => s.isVerified).length;
    const avgRisk = screenings.length > 0 
      ? screenings.reduce((sum, s) => sum + s.publicValue1, 0) / screenings.length 
      : 0;
    
    const highRiskCount = screenings.filter(s => s.publicValue1 > 7).length;

    return (
      <div className="statistics-panels">
        <div className="panel metal-panel">
          <h3>Total Screenings</h3>
          <div className="stat-value">{totalScreenings}</div>
          <div className="stat-trend">+{highRiskCount} high risk</div>
        </div>
        
        <div className="panel metal-panel">
          <h3>Verified Data</h3>
          <div className="stat-value">{verifiedScreenings}/{totalScreenings}</div>
          <div className="stat-trend">FHE Verified</div>
        </div>
        
        <div className="panel metal-panel">
          <h3>Avg Risk Level</h3>
          <div className="stat-value">{avgRisk.toFixed(1)}/10</div>
          <div className="stat-trend">Encrypted Analysis</div>
        </div>
      </div>
    );
  };

  const renderRiskChart = (screening: GeneticScreeningData, decryptedRisk: number | null) => {
    const analysis = analyzeRisk(screening, decryptedRisk);
    
    return (
      <div className="risk-chart">
        <div className="chart-row">
          <div className="chart-label">Risk Score</div>
          <div className="chart-bar">
            <div 
              className="bar-fill risk-high" 
              style={{ width: `${analysis.riskScore}%` }}
            >
              <span className="bar-value">{analysis.riskScore}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Probability</div>
          <div className="chart-bar">
            <div 
              className="bar-fill" 
              style={{ width: `${Math.min(100, analysis.probability)}%` }}
            >
              <span className="bar-value">{analysis.probability}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Severity</div>
          <div className="chart-bar">
            <div 
              className="bar-fill risk-medium" 
              style={{ width: `${analysis.severity}%` }}
            >
              <span className="bar-value">{analysis.severity}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Confidence</div>
          <div className="chart-bar">
            <div 
              className="bar-fill confidence" 
              style={{ width: `${analysis.confidence}%` }}
            >
              <span className="bar-value">{analysis.confidence}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Prevention Score</div>
          <div className="chart-bar">
            <div 
              className="bar-fill prevention" 
              style={{ width: `${analysis.preventionScore}%` }}
            >
              <span className="bar-value">{analysis.preventionScore}</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const filteredScreenings = screenings.filter(screening =>
    screening.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    screening.diseaseCode.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const faqItems = [
    {
      question: "What is FHE genetic screening?",
      answer: "FHE (Fully Homomorphic Encryption) allows genetic data analysis without decrypting sensitive information, ensuring complete privacy."
    },
    {
      question: "How is my data protected?",
      answer: "Your genetic risk scores are encrypted using Zama FHE technology and only decrypted locally with your permission."
    },
    {
      question: "What can the system analyze?",
      answer: "The system compares encrypted genetic markers with known disease patterns using homomorphic encryption techniques."
    }
  ];

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>GeneScreen_Z 🔬</h1>
            <span className="subtitle">Private Genetic Disease Screening</span>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔬</div>
            <h2>Connect Your Wallet to Begin</h2>
            <p>Please connect your wallet to initialize the encrypted genetic screening system and access private disease risk analysis.</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet using the button above</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE system will automatically initialize</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Start encrypted genetic screening with complete privacy</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p>Status: {fhevmInitializing ? "Initializing FHEVM" : status}</p>
        <p className="loading-note">Securing your genetic data</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted screening system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>GeneScreen_Z 🔬</h1>
          <span className="subtitle">Private Genetic Disease Screening</span>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + New Screening
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="dashboard-section">
          <h2>Private Genetic Screening Dashboard (FHE 🔐)</h2>
          {renderStatistics()}
          
          <div className="search-section">
            <input
              type="text"
              placeholder="Search screenings..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
          </div>
        </div>
        
        <div className="screenings-section">
          <div className="section-header">
            <h2>Genetic Screening Records</h2>
            <div className="header-actions">
              <button 
                onClick={loadData} 
                className="refresh-btn" 
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
              <button 
                onClick={() => setShowFAQ(!showFAQ)}
                className="faq-btn"
              >
                {showFAQ ? "Hide FAQ" : "Show FAQ"}
              </button>
            </div>
          </div>
          
          {showFAQ && (
            <div className="faq-section">
              <h3>Frequently Asked Questions</h3>
              {faqItems.map((item, index) => (
                <div key={index} className="faq-item">
                  <div className="faq-question">{item.question}</div>
                  <div className="faq-answer">{item.answer}</div>
                </div>
              ))}
            </div>
          )}
          
          <div className="screenings-list">
            {filteredScreenings.length === 0 ? (
              <div className="no-screenings">
                <p>No genetic screenings found</p>
                <button 
                  className="create-btn" 
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Screening
                </button>
              </div>
            ) : filteredScreenings.map((screening, index) => (
              <div 
                className={`screening-item ${selectedScreening?.id === screening.id ? "selected" : ""} ${screening.isVerified ? "verified" : ""}`} 
                key={index}
                onClick={() => setSelectedScreening(screening)}
              >
                <div className="screening-title">{screening.name}</div>
                <div className="screening-meta">
                  <span>Disease Code: {screening.publicValue1}</span>
                  <span>Created: {new Date(screening.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className="screening-status">
                  Status: {screening.isVerified ? "✅ Verified" : "🔓 Ready for Verification"}
                  {screening.isVerified && screening.decryptedValue && (
                    <span className="verified-risk">Risk Level: {screening.decryptedValue}</span>
                  )}
                </div>
                <div className="screening-creator">Creator: {screening.creator.substring(0, 6)}...{screening.creator.substring(38)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateScreening 
          onSubmit={createScreening} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingScreening} 
          screeningData={newScreeningData} 
          setScreeningData={setNewScreeningData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedScreening && (
        <ScreeningDetailModal 
          screening={selectedScreening} 
          onClose={() => { 
            setSelectedScreening(null); 
            setDecryptedData({ riskScore: null, probability: null }); 
          }} 
          decryptedData={decryptedData} 
          setDecryptedData={setDecryptedData} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedScreening.diseaseCode)}
          renderRiskChart={renderRiskChart}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateScreening: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  screeningData: any;
  setScreeningData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, screeningData, setScreeningData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'riskLevel') {
      const intValue = value.replace(/[^\d]/g, '');
      setScreeningData({ ...screeningData, [name]: intValue });
    } else {
      setScreeningData({ ...screeningData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-screening-modal">
        <div className="modal-header">
          <h2>New Genetic Screening</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Genetic Privacy</strong>
            <p>Risk level will be encrypted with Zama FHE 🔐 (Integer only)</p>
          </div>
          
          <div className="form-group">
            <label>Screening Name *</label>
            <input 
              type="text" 
              name="name" 
              value={screeningData.name} 
              onChange={handleChange} 
              placeholder="Enter screening name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Risk Level (Integer only) *</label>
            <input 
              type="number" 
              name="riskLevel" 
              value={screeningData.riskLevel} 
              onChange={handleChange} 
              placeholder="Enter risk level (1-10)..." 
              step="1"
              min="1"
              max="10"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Disease Code (1-100) *</label>
            <input 
              type="number" 
              min="1" 
              max="100" 
              name="diseaseCode" 
              value={screeningData.diseaseCode} 
              onChange={handleChange} 
              placeholder="Enter disease code..." 
            />
            <div className="data-type-label">Public Data</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !screeningData.name || !screeningData.riskLevel || !screeningData.diseaseCode} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Creating..." : "Create Screening"}
          </button>
        </div>
      </div>
    </div>
  );
};

const ScreeningDetailModal: React.FC<{
  screening: GeneticScreeningData;
  onClose: () => void;
  decryptedData: { riskScore: number | null; probability: number | null };
  setDecryptedData: (value: { riskScore: number | null; probability: number | null }) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
  renderRiskChart: (screening: GeneticScreeningData, decryptedRisk: number | null) => JSX.Element;
}> = ({ screening, onClose, decryptedData, setDecryptedData, isDecrypting, decryptData, renderRiskChart }) => {
  const handleDecrypt = async () => {
    if (decryptedData.riskScore !== null) { 
      setDecryptedData({ riskScore: null, probability: null }); 
      return; 
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedData({ riskScore: decrypted, probability: decrypted });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="screening-detail-modal">
        <div className="modal-header">
          <h2>Genetic Screening Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="screening-info">
            <div className="info-item">
              <span>Screening Name:</span>
              <strong>{screening.name}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{screening.creator.substring(0, 6)}...{screening.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date Created:</span>
              <strong>{new Date(screening.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>Disease Code:</span>
              <strong>{screening.publicValue1}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Risk Data</h3>
            
            <div className="data-row">
              <div className="data-label">Risk Level:</div>
              <div className="data-value">
                {screening.isVerified && screening.decryptedValue ? 
                  `${screening.decryptedValue}/10 (Verified)` : 
                  decryptedData.riskScore !== null ? 
                  `${decryptedData.riskScore}/10 (Decrypted)` : 
                  "🔒 FHE Encrypted"
                }
              </div>
              <button 
                className={`decrypt-btn ${(screening.isVerified || decryptedData.riskScore !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 Verifying..."
                ) : screening.isVerified ? (
                  "✅ Verified"
                ) : decryptedData.riskScore !== null ? (
                  "🔄 Re-verify"
                ) : (
                  "🔓 Verify Decryption"
                )}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE 🔐 Privacy Protection</strong>
                <p>Genetic risk data is encrypted on-chain. Click "Verify Decryption" to perform private analysis with FHE technology.</p>
              </div>
            </div>
          </div>
          
          {(screening.isVerified || decryptedData.riskScore !== null) && (
            <div className="analysis-section">
              <h3>Risk Analysis Report</h3>
              {renderRiskChart(
                screening, 
                screening.isVerified ? screening.decryptedValue || null : decryptedData.riskScore
              )}
              
              <div className="decrypted-values">
                <div className="value-item">
                  <span>Risk Level:</span>
                  <strong>
                    {screening.isVerified ? 
                      `${screening.decryptedValue}/10 (Verified)` : 
                      `${decryptedData.riskScore}/10 (Decrypted)`
                    }
                  </strong>
                  <span className={`data-badge ${screening.isVerified ? 'verified' : 'local'}`}>
                    {screening.isVerified ? 'Verified' : 'Local Analysis'}
                  </span>
                </div>
                <div className="value-item">
                  <span>Disease Code:</span>
                  <strong>{screening.publicValue1}</strong>
                  <span className="data-badge public">Public Data</span>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!screening.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "Verifying..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;


