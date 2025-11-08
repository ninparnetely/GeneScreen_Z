pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract GeneScreenAdapter is ZamaEthereumConfig {
    
    struct GeneticData {
        string patientId;                    
        euint32 encryptedGenes;        
        uint256 markerCount;          
        uint256 riskThreshold;          
        string notes;            
        address submitter;               
        uint256 submissionTime;             
        uint32 riskScore; 
        bool isAnalyzed; 
    }
    

    mapping(string => GeneticData) public geneticRecords;
    
    string[] public patientIds;
    
    event GeneticDataSubmitted(string indexed patientId, address indexed submitter);
    event AnalysisCompleted(string indexed patientId, uint32 riskScore);
    
    constructor() ZamaEthereumConfig() {
    }
    
    function submitGeneticData(
        string calldata patientId,
        string calldata patientName,
        externalEuint32 encryptedGenes,
        bytes calldata inputProof,
        uint256 markerCount,
        uint256 riskThreshold,
        string calldata notes
    ) external {
        require(bytes(geneticRecords[patientId].patientId).length == 0, "Genetic data already exists");
        
        require(FHE.isInitialized(FHE.fromExternal(encryptedGenes, inputProof)), "Invalid encrypted input");
        
        geneticRecords[patientId] = GeneticData({
            patientId: patientId,
            encryptedGenes: FHE.fromExternal(encryptedGenes, inputProof),
            markerCount: markerCount,
            riskThreshold: riskThreshold,
            notes: notes,
            submitter: msg.sender,
            submissionTime: block.timestamp,
            riskScore: 0,
            isAnalyzed: false
        });
        
        FHE.allowThis(geneticRecords[patientId].encryptedGenes);
        
        FHE.makePubliclyDecryptable(geneticRecords[patientId].encryptedGenes);
        
        patientIds.push(patientId);
        
        emit GeneticDataSubmitted(patientId, msg.sender);
    }
    
    function completeAnalysis(
        string calldata patientId, 
        bytes memory abiEncodedRiskScore,
        bytes memory analysisProof
    ) external {
        require(bytes(geneticRecords[patientId].patientId).length > 0, "Genetic data does not exist");
        require(!geneticRecords[patientId].isAnalyzed, "Data already analyzed");
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(geneticRecords[patientId].encryptedGenes);
        
        FHE.checkSignatures(cts, abiEncodedRiskScore, analysisProof);
        
        uint32 decodedScore = abi.decode(abiEncodedRiskScore, (uint32));
        
        geneticRecords[patientId].riskScore = decodedScore;
        geneticRecords[patientId].isAnalyzed = true;
        
        emit AnalysisCompleted(patientId, decodedScore);
    }
    
    function getEncryptedGenes(string calldata patientId) external view returns (euint32) {
        require(bytes(geneticRecords[patientId].patientId).length > 0, "Genetic data does not exist");
        return geneticRecords[patientId].encryptedGenes;
    }
    
    function getGeneticRecord(string calldata patientId) external view returns (
        string memory patientName,
        uint256 markerCount,
        uint256 riskThreshold,
        string memory notes,
        address submitter,
        uint256 submissionTime,
        bool isAnalyzed,
        uint32 riskScore
    ) {
        require(bytes(geneticRecords[patientId].patientId).length > 0, "Genetic data does not exist");
        GeneticData storage data = geneticRecords[patientId];
        
        return (
            data.patientId,
            data.markerCount,
            data.riskThreshold,
            data.notes,
            data.submitter,
            data.submissionTime,
            data.isAnalyzed,
            data.riskScore
        );
    }
    
    function getAllPatientIds() external view returns (string[] memory) {
        return patientIds;
    }
    
    function isAvailable() public pure returns (bool) {
        return true;
    }
}


