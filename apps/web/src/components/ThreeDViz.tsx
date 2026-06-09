import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  OrbitControls,
  Text,
  Html,
  Environment,
  useTexture,
  Sphere,
  Line,
} from '@react-three/drei';
import * as THREE from 'three';
import type { Player, GameState, GamePhase } from '@mafia/shared/types';
import { api } from '../services/api';
import { websocket } from '../services/websocket';

// ── Types ────────────────────────────────────────────────────────────
interface ThreeDVizProps {
  gameId?: string;
  embedded?: boolean;
}

interface PlayerNode {
  id: string;
  name: string;
  role: string;
  isAlive: boolean;
  isMafia: boolean;
  position: THREE.Vector3;
  targetPosition: THREE.Vector3;
}

// ── Constants ────────────────────────────────────────────────────────
const TABLE_RADIUS = 8;
const PLAYER_SEATS = 8; // max players around table
const TABLE_HEIGHT = 1.5;

const ROLE_COLORS: Record<string, string> = {
  MAFIA: '#ef4444',
  DOCTOR: '#ffffff',
  SHERIFF: '#f59e0b',
  VIGILANTE: '#8b5cf6',
  VILLAGER: '#3b82f6',
  UNASSIGNED: '#6b7280',
};

const PHASE_LIGHTING: Record<string, { ambient: number; directional: number; bg: string; fog: string }> = {
  NIGHT_ACTIONS: { ambient: 0.15, directional: 0.2, bg: '#0a0a1a', fog: '#0a0a1a' },
  MORNING_REVEAL: { ambient: 0.5, directional: 0.6, bg: '#1a1a2e', fog: '#1a1a2e' },
  DAY_DISCUSSION: { ambient: 0.8, directional: 1.0, bg: '#1e293b', fog: '#1e293b' },
  DAY_VOTING: { ambient: 0.7, directional: 0.9, bg: '#1e293b', fog: '#1e293b' },
  RESOLUTION: { ambient: 0.6, directional: 0.5, bg: '#162032', fog: '#162032' },
  SETUP: { ambient: 0.7, directional: 0.8, bg: '#0f172a', fog: '#0f172a' },
  GAME_OVER: { ambient: 0.4, directional: 0.3, bg: '#0a0a14', fog: '#0a0a14' },
};

// ── Helper: compute seat positions on circle ─────────────────────────
function computeSeatPosition(index: number, total: number, radius: number): THREE.Vector3 {
  const angle = (index / total) * Math.PI * 2 - Math.PI / 2;
  return new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
}

// ── Sub-components ───────────────────────────────────────────────────

/** The round table in the center */
const RoundTable: React.FC = () => {
  return (
    <group>
      {/* Table top */}
      <mesh position={[0, TABLE_HEIGHT, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[TABLE_RADIUS * 0.95, TABLE_RADIUS, 0.2, 64]} />
        <meshStandardMaterial color="#4a3728" roughness={0.4} metalness={0.3} />
      </mesh>
      {/* Table edge ring */}
      <mesh position={[0, TABLE_HEIGHT + 0.05, 0]} receiveShadow>
        <torusGeometry args={[TABLE_RADIUS, 0.3, 16, 64]} />
        <meshStandardMaterial color="#5c4433" roughness={0.3} metalness={0.4} />
      </mesh>
      {/* Table base/pedestal */}
      <mesh position={[0, TABLE_HEIGHT - 0.8, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[1.2, 1.8, 1.5, 32]} />
        <meshStandardMaterial color="#2d1f14" roughness={0.5} metalness={0.2} />
      </mesh>
    </group>
  );
};

/** Individual player figure (seated at table) */
const PlayerFigure: React.FC<{
  player: PlayerNode;
  isHovered: boolean;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}> = React.memo(({ player, isHovered, onPointerEnter, onPointerLeave }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const deathY = useRef(player.isAlive ? 0 : -3);

  const color = ROLE_COLORS[player.role] || '#6b7280';
  const isDead = !player.isAlive;
  const targetOpacity = isDead ? 0.3 : 1.0;
  const opacityRef = useRef(targetOpacity);
  const emissiveIntensity = isHovered ? 0.4 : 0.05;
  const emissiveTarget = player.isMafia && player.isAlive ? 0.3 : emissiveIntensity;

  useFrame((_, delta) => {
    if (!meshRef.current) return;
    const mesh = meshRef.current;

    // Smooth position toward target
    mesh.position.lerp(player.targetPosition, 0.05);

    // Bob alive players
    if (player.isAlive) {
      mesh.position.y = player.targetPosition.y + Math.sin(Date.now() * 0.002 + player.id.charCodeAt(0)) * 0.4;
    } else {
      deathY.current += (-3 - deathY.current) * 0.03;
      mesh.position.y = deathY.current;
    }

    // Smooth opacity transition
    const mat = mesh.material as THREE.MeshStandardMaterial;
    opacityRef.current += (targetOpacity - opacityRef.current) * 0.05;
    mat.opacity = Math.max(0.15, opacityRef.current);

    // Emissive for mafia glow
    const currentEmissive = player.isMafia && player.isAlive ? 0.3 : 0.05;
    mat.emissiveIntensity += (currentEmissive - mat.emissiveIntensity) * 0.1;

    // Slow spin for alive
    if (player.isAlive) {
      mesh.rotation.y += delta * 0.5;
    }

    // Glow pulse
    if (glowRef.current) {
      const glowMat = glowRef.current.material as THREE.MeshBasicMaterial;
      glowMat.opacity = player.isMafia && player.isAlive
        ? 0.25 + Math.sin(Date.now() * 0.004) * 0.1
        : isHovered ? 0.2 : 0.1;
    }
  });

  return (
    <group>
      <mesh
        ref={meshRef}
        position={[player.targetPosition.x, player.targetPosition.y, player.targetPosition.z]}
        castShadow
        receiveShadow
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        userData={{ playerId: player.id }}
      >
        <sphereGeometry args={[1.2, 32, 32]} />
        <meshStandardMaterial
          color={color}
          roughness={0.4}
          metalness={0.6}
          transparent
          opacity={player.isAlive ? 1 : 0.5}
          emissive={player.isMafia ? color : '#000000'}
          emissiveIntensity={player.isMafia && player.isAlive ? 0.3 : 0.05}
        />
        {/* Glow sphere */}
        <mesh ref={glowRef}>
          <sphereGeometry args={[1.6, 32, 32]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={player.isMafia && player.isAlive ? 0.2 : 0.1}
            depthWrite={false}
          />
        </mesh>
        {/* Sheriff badge */}
        {player.role === 'SHERIFF' && player.isAlive && (
          <mesh position={[0, 1.0, 0.9]} rotation={[0.3, 0, 0]}>
            <cylinderGeometry args={[0.35, 0.35, 0.08, 6]} />
            <meshStandardMaterial color="#ffd700" roughness={0.2} metalness={0.9} emissive="#b8860b" emissiveIntensity={0.5} />
          </mesh>
        )}
      </mesh>
      {/* Name label */}
      <Html
        position={[player.targetPosition.x, player.targetPosition.y + 2.2, player.targetPosition.z]}
        center
        distanceFactor={15}
        occlude={false}
      >
        <div
          style={{
            color: 'white',
            fontSize: '12px',
            fontWeight: 'bold',
            textShadow: '0 1px 3px rgba(0,0,0,0.8)',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            opacity: isDead ? 0.5 : 1,
            transition: 'opacity 0.5s',
          }}
        >
          {player.name}
        </div>
      </Html>
    </group>
  );
});

/** Animated ambient & directional lighting driven by game phase */
const SceneLights: React.FC<{ phase: GamePhase }> = ({ phase }) => {
  const ambientRef = useRef<THREE.AmbientLight>(null);
  const directionalRef = useRef<THREE.DirectionalLight>(null);
  const currentPhase = useRef(phase);
  const transitionProgress = useRef(1.0);

  const lighting = PHASE_LIGHTING[phase] || PHASE_LIGHTING.SETUP;

  // Reset transition when phase changes
  if (currentPhase.current !== phase) {
    transitionProgress.current = 0;
    currentPhase.current = phase;
  }

  useFrame((_, delta) => {
    if (transitionProgress.current < 1) {
      transitionProgress.current = Math.min(1, transitionProgress.current + delta * 0.5);
    }

    const t = transitionProgress.current;
    const prevLighting = PHASE_LIGHTING[currentPhase.current] || PHASE_LIGHTING.SETUP;

    if (ambientRef.current) {
      ambientRef.current.intensity = THREE.MathUtils.lerp(
        prevLighting.ambient,
        lighting.ambient,
        t,
      );
    }
    if (directionalRef.current) {
      directionalRef.current.intensity = THREE.MathUtils.lerp(
        prevLighting.directional,
        lighting.directional,
        t,
      );
      // Tilt directional light: night = lower angle, day = higher
      const targetAngle = phase.startsWith('NIGHT') ? 0.3 : 0.8;
      directionalRef.current.position.y = THREE.MathUtils.lerp(
        directionalRef.current.position.y,
        targetAngle * 20,
        0.02,
      );
    }
  });

  return (
    <>
      <ambientLight ref={ambientRef} intensity={lighting.ambient} color="#ffffff" />
      <directionalLight
        ref={directionalRef}
        position={[5, 15, 8]}
        intensity={lighting.directional}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-far={50}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
      />
      {/* Spot light from above the table */}
      <spotLight
        position={[0, 25, 0]}
        angle={0.4}
        penumbra={0.5}
        intensity={phase.startsWith('NIGHT') ? 0.1 : 0.4}
        castShadow
        color={phase.startsWith('NIGHT') ? '#334466' : '#ffffff'}
      />
    </>
  );
};

/** Stars/particle background for night ambiance */
const Starfield: React.FC<{ visible: boolean }> = ({ visible }) => {
  const pointsRef = useRef<THREE.Points>(null);
  const opacity = useRef(visible ? 0 : 1);

  const positions = useMemo(() => {
    const arr = new Float32Array(200 * 3);
    for (let i = 0; i < 200; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 60;
      arr[i * 3 + 1] = Math.random() * 30 + 5;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 60;
    }
    return arr;
  }, []);

  useFrame(() => {
    if (!pointsRef.current) return;
    const target = visible ? 1 : 0;
    opacity.current += (target - opacity.current) * 0.03;
    pointsRef.current.visible = opacity.current > 0.01;
    (pointsRef.current.material as THREE.PointsMaterial).opacity = opacity.current;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          array={positions}
          count={positions.length / 3}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial size={0.15} color="#ffffff" transparent opacity={0} depthWrite={false} />
    </points>
  );
};

/** Connection lines between mafia members */
const MafiaConnections: React.FC<{
  players: PlayerNode[];
}> = React.memo(({ players }) => {
  const mafiaAlive = players.filter((p) => p.isMafia && p.isAlive);
  if (mafiaAlive.length < 2) return null;

  const points: [THREE.Vector3, THREE.Vector3][] = [];
  for (let i = 0; i < mafiaAlive.length; i++) {
    for (let j = i + 1; j < mafiaAlive.length; j++) {
      points.push([mafiaAlive[i].targetPosition, mafiaAlive[j].targetPosition]);
    }
  }

  return (
    <group>
      {points.map(([a, b], i) => (
        <Line
          key={i}
          points={[a, b]}
          color="#ef4444"
          lineWidth={1}
          transparent
          opacity={0.2 + Math.sin(i) * 0.1}
          depthWrite={false}
        />
      ))}
    </group>
  );
});

// ── Main Scene Content ────────────────────────────────────────────────
const SceneContent: React.FC<{
  players: PlayerNode[];
  phase: GamePhase;
  hoveredId: string | null;
  setHovered: (id: string | null) => void;
}> = ({ players, phase, hoveredId, setHovered }) => {
  const isNight = phase.startsWith('NIGHT') || phase === 'NIGHT_ACTIONS';

  return (
    <>
      <SceneLights phase={phase} />
      <Starfield visible={isNight} />

      {/* Fog */}
      <fog attach="fog" args={[
        isNight ? '#0a0a1a' : '#1e293b',
        isNight ? 15 : 25,
        isNight ? 45 : 65,
      ]} />

      {/* Ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.5, 0]} receiveShadow>
        <circleGeometry args={[22, 64]} />
        <meshStandardMaterial color="#1e293b" roughness={0.8} metalness={0.2} />
      </mesh>

      {/* Grid */}
      <gridHelper args={[40, 20, '#334155', '#1e293b']} position={[0, -2.49, 0]} />

      <RoundTable />

      {/* Players */}
      {players.map((player) => (
        <PlayerFigure
          key={player.id}
          player={player}
          isHovered={hoveredId === player.id}
          onPointerEnter={() => setHovered(player.id)}
          onPointerLeave={() => setHovered(null)}
        />
      ))}

      {/* Mafia connections */}
      <MafiaConnections players={players} />

      {/* Chairs (simple cubes) */}
      {players.map((player, i) => {
        const seatPos = player.targetPosition.clone();
        const outward = seatPos.clone().normalize();
        const chairPos = seatPos.clone().add(outward.multiplyScalar(1.8));
        chairPos.y = -0.5;
        return (
          <mesh key={`chair-${player.id}`} position={chairPos} castShadow receiveShadow>
            <boxGeometry args={[0.8, 0.8, 0.8]} />
            <meshStandardMaterial color="#475569" roughness={0.6} />
          </mesh>
        );
      })}

      {/* Ambient environment */}
      <Environment preset="night" />
    </>
  );
};

// ── HUD Overlay ──────────────────────────────────────────────────────
const HUDOverlay: React.FC<{
  phase: GamePhase;
  dayNumber: number;
  roundNumber: number;
  aliveCount: number;
  totalPlayers: number;
  hoveredPlayer: PlayerNode | null;
  onBack: () => void;
}> = ({ phase, dayNumber, roundNumber, aliveCount, totalPlayers, hoveredPlayer, onBack }) => {
  const phaseLabel = phase.replace(/_/g, ' ');
  const isNight = phase.startsWith('NIGHT') || phase === 'NIGHT_ACTIONS';

  return (
    <>
      {/* Status bar */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          zIndex: 100,
          background: 'rgba(15, 23, 42, 0.9)',
          padding: '12px 16px',
          borderRadius: 12,
          border: '1px solid #334155',
          color: 'white',
          fontFamily: 'system-ui, sans-serif',
          minWidth: 220,
        }}
      >
        <div style={{ fontSize: '1rem', fontWeight: 'bold', marginBottom: 4 }}>
          🎭 3D View
        </div>
        <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
          Phase: <span style={{ color: isNight ? '#818cf8' : '#fbbf24' }}>{phaseLabel}</span>
        </div>
        <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
          Day: {dayNumber} | Round: {roundNumber}
        </div>
        <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
          Alive: {aliveCount}/{totalPlayers}
        </div>
      </div>

      {/* Legend */}
      <div
        style={{
          position: 'absolute',
          bottom: 16,
          right: 16,
          zIndex: 100,
          background: 'rgba(15, 23, 42, 0.9)',
          padding: '10px 14px',
          borderRadius: 10,
          border: '1px solid #334155',
          color: 'white',
          fontFamily: 'system-ui, sans-serif',
          fontSize: '0.75rem',
        }}
      >
        <div style={{ fontWeight: 'bold', marginBottom: 6 }}>Roles</div>
        <LegendItem color="#ef4444" label="Mafia" />
        <LegendItem color="#3b82f6" label="Villager" />
        <LegendItem color="#f59e0b" label="Sheriff" />
        <LegendItem color="#8b5cf6" label="Vigilante" />
        <LegendItem color="#ffffff" label="Doctor" />
      </div>

      {/* Controls */}
      <div
        style={{
          position: 'absolute',
          bottom: 16,
          left: 16,
          zIndex: 100,
          display: 'flex',
          gap: 8,
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: '#334155',
            border: 'none',
            color: 'white',
            padding: '8px 14px',
            borderRadius: 6,
            cursor: 'pointer',
            fontFamily: 'system-ui, sans-serif',
            fontSize: '0.8rem',
          }}
        >
          ← Back
        </button>
      </div>

      {/* Tooltip on hover */}
      {hoveredPlayer && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 200,
            background: 'rgba(15, 23, 42, 0.95)',
            padding: '10px 14px',
            borderRadius: 8,
            border: '1px solid #334155',
            color: 'white',
            fontFamily: 'system-ui, sans-serif',
            fontSize: '0.8rem',
            pointerEvents: 'none',
          }}
        >
          <div style={{ fontWeight: 'bold' }}>{hoveredPlayer.name}</div>
          <div style={{ color: ROLE_COLORS[hoveredPlayer.role] || '#94a3b8' }}>
            {hoveredPlayer.role}
          </div>
          <div style={{ color: hoveredPlayer.isAlive ? '#22c55e' : '#ef4444' }}>
            {hoveredPlayer.isAlive ? 'Alive' : 'Dead'}
          </div>
        </div>
      )}
    </>
  );
};

const LegendItem: React.FC<{ color: string; label: string }> = ({ color, label }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
    <div style={{ width: 12, height: 12, borderRadius: '50%', background: color }} />
    <span>{label}</span>
  </div>
);

// ── Main Component ───────────────────────────────────────────────────
const ThreeDViz: React.FC<ThreeDVizProps> = ({ gameId: propGameId, embedded = false }) => {
  const params = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const gameId = propGameId || params.gameId || '';

  const [players, setPlayers] = useState<PlayerNode[]>([]);
  const [phase, setPhase] = useState<GamePhase>('SETUP');
  const [dayNumber, setDayNumber] = useState(0);
  const [roundNumber, setRoundNumber] = useState(0);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Layout players around the table
  const layoutPlayers = useCallback((rawPlayers: Player[]) => {
    const total = rawPlayers.length;
    return rawPlayers.map((p, i) => {
      const pos = computeSeatPosition(i, Math.max(total, 1), TABLE_RADIUS);
      return {
        id: p.id,
        name: p.name,
        role: p.role,
        isAlive: p.isAlive,
        isMafia: p.isMafia,
        position: pos.clone(),
        targetPosition: pos.clone(),
      } as PlayerNode;
    });
  }, []);

  // Fetch initial game data
  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await api.games.get(gameId) as any;
        if (cancelled) return;

        // The API returns { success: true, data: {...} } — unwrap
        const game = response?.data || response;
        if (game?.players) {
          setPlayers(layoutPlayers(game.players));
        }
        if (game?.currentState) {
          setPhase(game.currentState.phase || 'SETUP');
          setDayNumber(game.currentState.dayNumber || 0);
          setRoundNumber(game.currentState.turnNumber || 0);
        }
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError('Failed to load game data');
          setLoading(false);
        }
      }
    };

    load();

    // Subscribe to WebSocket events
    const unsubs: (() => void)[] = [];

    websocket.send({ type: 'JOIN_GAME', payload: { gameId } });

    unsubs.push(
      websocket.on('GAME_STATE', (data: unknown) => {
        const stateData = data as any;
        const state = stateData?.state || stateData;
        if (state?.phase) setPhase(state.phase);
        if (state?.dayNumber !== undefined) setDayNumber(state.dayNumber);
        if (state?.turnNumber !== undefined) setRoundNumber(state.turnNumber);
      }),
    );

    unsubs.push(
      websocket.on('GAME_EVENT', (event: unknown) => {
        const evt = event as any;
        if (!evt || evt.gameId !== gameId) return;

        switch (evt.type) {
          case 'PHASE_CHANGED': {
            const toPhase = evt.data?.toPhase as GamePhase;
            if (toPhase) setPhase(toPhase);
            break;
          }
          case 'PLAYER_ELIMINATED': {
            const playerId = evt.data?.playerId || evt.targetId;
            if (playerId) {
              setPlayers((prev) =>
                prev.map((p) =>
                  p.id === playerId ? { ...p, isAlive: false } : p,
                ),
              );
            }
            break;
          }
          case 'ROLES_ASSIGNED': {
            // Refresh players to get updated roles
            api.games.get(gameId).then((res: any) => {
              const game = res?.data || res;
              if (game?.players) {
                setPlayers(layoutPlayers(game.players));
              }
            }).catch(() => {});
            break;
          }
          case 'GAME_STARTED': {
            api.games.get(gameId).then((res: any) => {
              const game = res?.data || res;
              if (game?.players) {
                setPlayers(layoutPlayers(game.players));
              }
              if (game?.currentState) {
                setPhase(game.currentState.phase || 'IN_PROGRESS');
                setDayNumber(game.currentState.dayNumber || 1);
              }
            }).catch(() => {});
            break;
          }
          case 'GAME_ENDED':
          case 'MAFIA_WINS':
          case 'TOWN_WINS':
            setPhase('GAME_OVER');
            break;
        }
      }),
    );

    return () => {
      cancelled = true;
      unsubs.forEach((fn) => fn());
    };
  }, [gameId, layoutPlayers]);

  const hoveredPlayer = players.find((p) => p.id === hoveredId) || null;
  const aliveCount = players.filter((p) => p.isAlive).length;

  if (loading) {
    return (
      <div style={{
        width: '100%',
        height: embedded ? '100%' : '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0f172a',
        color: 'white',
        fontFamily: 'system-ui, sans-serif',
      }}>
        <div>
          <div style={{ fontSize: '1.5rem', marginBottom: 8 }}>🎭</div>
          <div>Loading 3D scene...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        width: '100%',
        height: embedded ? '100%' : '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0f172a',
        color: '#ef4444',
        fontFamily: 'system-ui, sans-serif',
      }}>
        <div>
          <div style={{ fontSize: '1.5rem', marginBottom: 8 }}>⚠️</div>
          <div>{error}</div>
          <button
            onClick={() => navigate('/')}
            style={{
              marginTop: 12,
              background: '#334155',
              border: 'none',
              color: 'white',
              padding: '8px 16px',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Back to Games
          </button>
        </div>
      </div>
    );
  }

  const isNight = phase.startsWith('NIGHT') || phase === 'NIGHT_ACTIONS';

  return (
    <div style={{
      width: '100%',
      height: embedded ? '100%' : '100vh',
      position: 'relative',
      background: isNight ? '#0a0a1a' : '#1e293b',
    }}>
      <Canvas
        shadows
        camera={{ position: [0, 18, 26], fov: 55, near: 0.1, far: 200 }}
        style={{ background: isNight ? '#0a0a1a' : '#1e293b' }}
        gl={{ antialias: true, alpha: false }}
      >
        <SceneContent
          players={players}
          phase={phase}
          hoveredId={hoveredId}
          setHovered={setHoveredId}
        />
        <OrbitControls
          enableDamping
          dampingFactor={0.1}
          minDistance={10}
          maxDistance={50}
          maxPolarAngle={Math.PI / 1.8}
          target={[0, TABLE_HEIGHT, 0]}
        />
      </Canvas>

      <HUDOverlay
        phase={phase}
        dayNumber={dayNumber}
        roundNumber={roundNumber}
        aliveCount={aliveCount}
        totalPlayers={players.length}
        hoveredPlayer={hoveredPlayer}
        onBack={() => navigate(embedded ? -1 as any : '/')}
      />
    </div>
  );
};

export default ThreeDViz;
