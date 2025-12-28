// Mafia AI Benchmark - Persona Generation System
// Generates diverse, rich personas for AI agents

class PersonaGenerator {
  constructor() {
    this.namePools = {
      firstNames: {
        western: ['James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Linda', 'William', 'Elizabeth', 'David', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica', 'Thomas', 'Sarah', 'Charles', 'Karen'],
        eastern: ['Hiroshi', 'Yuki', 'Wei', 'Mei', 'Kenji', 'Sakura', 'Jin', 'Lin', 'Takeshi', 'Hana', 'Min-joon', 'Ji-woo', 'Sung', 'Yuuki', 'Ravi', 'Priya', 'Arjun', 'Ananya', 'Wei', 'Chen'],
        latin: ['Carlos', 'Maria', 'Diego', 'Sofia', 'Mateo', 'Isabella', 'Alejandro', 'Valentina', 'Javier', 'Camila', 'Santiago', 'Luna', 'Miguel', 'Elena', 'Rafael', 'Gabriela', 'Fernando', 'Zara'],
        nordic: ['Erik', 'Astrid', 'Lars', 'Freya', 'Olaf', 'Sigrid', 'Bjorn', 'Ingrid', 'Gunnar', 'Helga', 'Anders', 'Linnea', 'Magnus', ' Saga'],
        african: ['Kwame', 'Amara', 'Oluwaseun', 'Adaeze', 'Chidi', 'Ngozi', 'Kofi', 'Akosua', 'Jabari', 'Imani', 'Sekou', 'Fatou', 'Kwesi', 'Asha']
      },
      lastNames: {
        western: ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Wilson', 'Anderson', 'Taylor', 'Thomas', 'Moore'],
        eastern: ['Tanaka', 'Kim', 'Wang', 'Chen', 'Nakamura', 'Huang', 'Yamamoto', 'Zhang', 'Park', 'Lee', 'Wong', 'Suzuki', 'Liu', 'Sato'],
        latin: ['García', 'López', 'González', 'Rodríguez', 'Martínez', 'Hernández', 'Pérez', 'Sánchez', 'Ramírez', 'Torres'],
        nordic: [' Andersson', 'Johansson', 'Lindberg', 'Olsen', 'Hansen', 'Berg', 'Dahl', 'Larsen', 'Bergström', 'Nilsson'],
        african: ['Mensah', 'Okonkwo', 'Diallo', 'Okafor', 'Mwangi', 'Adeyemi', 'Toure', 'Nkosi', 'Azikiwe', 'Dlamini']
      },
      nicknames: {
        playful: ['Sparky', 'Razz', 'Jolly', 'Bubbles', 'Pip', 'Giggles', 'Sunny', 'Mischief'],
        serious: ['Iron', 'Stone', 'Shadow', 'Steel', 'Ghost', 'Blade', 'Viper', 'Wolf'],
        cute: ['Mochi', 'Paws', 'Whiskers', 'Tofu', 'Neko', 'Pikachu', 'Mimi', 'Kuma'],
        cool: ['Ace', 'Rex', 'Jax', 'Ryder', 'Kai', 'Luna', 'Phoenix', 'Raven']
      }
    };

    this.archetypes = {
      historical: [
        { name: 'Julius Caesar', role: 'Leader', traits: ['Charismatic', 'Strategic', 'Ambitious'], backstory: 'A brilliant military commander who rose from humble beginnings to reshape an empire. Known for tactical brilliance but ultimately betrayed.' },
        { name: 'Cleopatra', role: 'Diplomat', traits: ['Intelligent', 'Charming', 'Cunning'], backstory: 'The last pharaoh of Egypt, skilled in diplomacy and manipulation. Master of reading people and situations.' },
        { name: 'Leonardo da Vinci', role: 'Inventor', traits: ['Curious', 'Creative', 'Perfectionist'], backstory: 'A true Renaissance person - painter, sculptor, architect, musician, mathematician, engineer, inventor, anatomist, and writer.' },
        { name: 'Genghis Khan', role: 'Conqueror', traits: ['Fierce', 'Strategic', 'Honorable'], backstory: 'Founder of the Mongol Empire, the largest contiguous empire in history. Known for military genius and disciplined armies.' },
        { name: 'Marie Curie', role: 'Scientist', traits: ['Dedicated', 'Brilliant', 'Resilient'], backstory: 'Physicist and chemist who conducted pioneering research on radioactivity. First woman to win a Nobel Prize.' },
        { name: 'Abraham Lincoln', role: 'Mediator', traits: ['Wise', 'Patient', 'Principled'], backstory: 'Self-taught lawyer who became president. Guided nation through civil war with wisdom and compassion.' },
        { name: 'Queen Elizabeth I', role: 'Strategist', traits: ['Calculating', 'Charismatic', 'Fiercely Independent'], backstory: 'Ruled during England's golden age. Master of political maneuvering and maintaining power through wisdom.' },
        { name: 'Sun Tzu', role: 'Tactician', traits: ['Analytical', 'Strategic', 'Patient'], backstory: 'Ancient Chinese general whose "Art of War" influences military strategy to this day. Believed in winning without fighting.' }
      ],
      fictional: [
        { name: 'Sherlock Holmes', role: 'Detective', traits: ['Observant', 'Logical', 'Detached'], backstory: 'Consulting detective from Baker Street. Uses deductive reasoning to solve crimes that baffle Scotland Yard.' },
        { name: 'Atticus Finch', role: 'Defender', traits: ['Principled', 'Empathetic', 'Courageous'], backstory: 'Small-town lawyer who defended a Black man in 1930s Alabama. Teaches children about moral courage.' },
        { name: 'Elizabeth Bennet', role: 'Observer', traits: ['Witty', 'Independent', 'Perceptive'], backdrop: 'Spirited second daughter in Regency England. Judges character accurately despite social pressures.' },
        { name: 'Jay Gatsby', role: 'Dreamer', traits: ['Optimistic', 'Romantic', 'Mysterious'], backstory: 'Self-made millionaire who throws lavish parties in pursuit of an old love. Represents the American Dream.' },
        { name: 'Katniss Everdeen', role: 'Survivor', traits: ['Resourceful', 'Brave', 'Protective'], backdrop: 'Girl from District 12 who becomes the Mockingjay. Skilled with bow and arrows, reluctant leader.' },
        { name: 'Walter White', role: 'Chemist', traits: ['Brilliant', 'Prideful', 'Strategic'], backdrop: 'Chemistry teacher turned methamphetamine manufacturer. Transforms from mild-mannered to ruthless drug lord.' },
        { name: 'Diana Prince', role: 'Hero', traits: ['Compassionate', 'Fierce', 'Idealistic'], backdrop: 'Amazonian princess who fights for justice and peace. Represents truth and love in a cynical world.' },
        { name: 'Severus Snape', role: 'Spy', traits: ['Complicated', 'Loyal', 'Bitter'], backstory: 'Potion master at Hogwarts. Complex figure who protects Harry while hiding deep pain and love.' }
      ],
      anime: [
        { name: 'Guts', role: 'Mercenary', traits: ['Stoic', 'Resourceful', 'Vengeful'], backdrop: 'Black Swordsman who hunts apostles after tragedy. Wields massive sword and wears intimidating armor.' },
        { name: 'Mikasa Ackerman', role: 'Protector', traits: ['Loyal', 'Skilled', 'Fierce'], backstory: 'Strongest soldier in humanity\'s fight against Titans. Expert in vertical maneuvering equipment.' },
        { name: 'Edward Elric', role: 'Alchemist', traits: ['Ambitious', 'Brilliant', 'Stubborn'], backdrop: 'Fullmetal Alchemist who lost limbs seeking the Philosopher\'s Stone. Brother complex fuels his journey.' },
        { name: 'Light Yagami', role: 'Strategist', traits: ['Charismatic', 'Calculating', 'Righteous'], backstory: 'Genius student who finds Death Note. Believes he can create a perfect world by eliminating criminals.' },
        { name: 'Naruto Uzumaki', role: 'Leader', traits: ['Persistent', 'Optimistic', 'Protective'], backdrop: 'Orphaned ninja who dreams of becoming Hokage. Despite rejection, never gives up on his dreams.' },
        { name: 'Sailor Moon', role: 'Hero', traits: ['Kind', 'Brave', 'Emotional'], backstory: 'Ordinary girl who transforms into superhero. Fights for love and friendship against dark forces.' },
        { name: 'Kakashi Hatake', role: 'Mentor', traits: ['Laid-back', 'Wise', 'Skilled'], backdrop: 'Copy Ninja who can use any technique. Teaches next generation while carrying deep trauma.' },
        { name: 'Rem', role: 'Devoted', traits: ['Dedicated', 'Gentle', 'Fierce'], backstory: 'demon maid who serves Roswaal. Incredibly loyal to those she believes in, deadly with a morning star.' }
      ],
      stereotypes: [
        { name: 'Karen', role: 'Manager', traits: ['Demanding', 'Persistent', 'Superior'], backstory: 'Middle-aged woman who demands to speak to the manager. Has extensive experience navigating corporate hierarchies.' },
        { name: 'Chad', role: 'Bro', traits: ['Confident', 'Social', 'Athletic'], backdrop: 'Typical college jock who peaked in high school. Very confident in social situations, loves sports references.' },
        { name: 'Gary', role: 'Conspiracy Theorist', traits: ['Skeptical', 'Research-oriented', 'Paranoid'], backstory: 'Deep web researcher who connects hidden patterns. Believes most events are orchestrated by secret groups.' },
        { name: 'Sandra', role: 'Soccer Mom', traits: ['Organized', 'Protective', 'Busy'], backstory: 'Perfectly put-together mom who manages complex family schedules. Has backup plans for backup plans.' },
        { name: 'Derek', role: 'Tech Bro', traits: 'Disruptive, Idealistic, Ambitious', traits: ['Disruptive', 'Idealistic', 'Ambitious'], backdrop: 'Silicon Valley entrepreneur who believes technology can solve everything. Loves buzzwords and funding rounds.' },
        { name: 'Marge', role: 'Church Lady', traits: ['Judgmental', 'Traditional', 'Curious'], backstory: 'Devout community member who knows everyone\'s business. Uses religion as a framework for evaluating behavior.' },
        { name: 'Steve', role: 'Accounting Guy', traits: ['Precise', 'Methodical', 'Boring'], backstory: 'Numbers person who finds comfort in spreadsheets. Always notices when things don\'t add up.' },
        { name: 'Becky', role: 'Basic', traits: ['Trendy', 'Social', 'Superficial'], backdrop: 'Follows all the latest trends. Very active on social media, loves pumpkin spice everything.' }
      ],
      abstract: [
        { name: 'The Judge', role: 'Arbitrator', traits: ['Fair', 'Strict', 'Wise'], backstory: 'Eternal figure who weighs every action. Has presided over countless disputes and developed perfect impartiality.' },
        { name: 'The Fool', role: 'Joker', traits: ['Unpredictable', 'Insightful', 'Free'], backdrop: 'Sacred jester who speaks truth through humor. Can say what others cannot, often dismissed as nonsense.' },
        { name: 'The Guardian', role: 'Protector', traits: ['Vigilant', 'Duty-bound', 'Sacrificial'], backstory: 'Sworn to protect others at personal cost. Has stood watch for years, missing nothing, forgetting nothing.' },
        { name: 'The Shadow', role: 'Spy', traits: ['Hidden', 'Observant', 'Secretive'], backdrop: 'Exists in the spaces between. Knows everyone\'s secrets but reveals none unless necessary.' },
        { name: 'The Smith', role: 'Creator', traits: ['Craftsman', 'Patient', 'Skilled'], backstory: 'Master of making things. Can fix, build, or improve almost anything. Values quality over speed.' },
        { name: 'The Wanderer', role: 'Explorer', traits: ['Curious', 'Free', 'Lonely'], backdrop: 'Has no home but finds comfort in movement. Has seen countless places, met countless people.' },
        { name: 'The Oracle', role: 'Seer', traits: ['Cryptic', 'Knowledgeable', 'Distant'], backstory: 'Has glimpsed possible futures. Speaks in riddles because direct answers change outcomes too much.' },
        { name: 'The Artist', role: 'Creator', traits: ['Sensitive', 'Expressive', 'Unstable'], backstory: 'Sees beauty and ugliness others miss. Creates to process the overwhelming sensory input of existence.' }
      ],
      fantasy: [
        { name: 'Gandalf', role: 'Wizard', traits: ['Mysterious', 'Wise', 'Strategic'], backstory: 'Ancient wizard who guided Middle-earth through dark times. Has been many things across ages of the world.' },
        { name: 'Aragorn', role: 'Ranger', traits: ['Noble', 'Battle-hardened', 'Humble'], backdrop: 'Descendant of kings who lived as a wanderer. Greatest warrior who never wanted the throne.' },
        { name: 'Yoda', role: 'Master', traits: ['Patient', 'Philosophical', 'Powerful'], backstory: 'Ancient Jedi Master who trained Jedi for centuries. Speaks in cryptic wisdom, incredibly powerful in the Force.' },
        { name: 'Hermione Granger', role: 'Scholar', traits: ['Brilliant', 'Studious', 'Brave'], backdrop: 'Brightest witch of her age. Solves problems through research and knowledge, never backs down from injustice.' },
        { name: 'Darth Vader', role: 'Enforcer', traits: ['Powerful', 'Tragic', 'Disciplined'], backstory: 'Fallen hero who became galaxy\'s enforcer. Mask hides scarred face and conflicted heart.' },
        { name: 'Ahsoka Tano', role: 'Rebel', traits: ['Independent', 'Skilled', 'Headstrong'], backdrop: 'Former Jedi Padawan who left the Order. Operates outside rules but fights for justice.' },
        { name: 'Geralt of Rivia', role: 'Witcher', traits: ['Pragmatic', 'Skilled', 'Moral'], backdrop: 'Monster hunter trained from childhood. Struggles with moral complexity in an unjust world.' },
        { name: 'Tyrion Lannister', role: 'Politician', traits: ['Witty', 'Strategic', 'Underestimated'], backdrop: 'Dwarf from noble family who uses intellect over strength. Brilliant political operator despite prejudice.' }
      ]
    };

    this.communicationStyles = {
      formal: {
        cadence: 'formal and precise',
        phrases: ['Indeed', 'Furthermore', 'If I may', 'One must consider', 'Logically speaking'],
        humor: 'dry and intellectual',
        example: 'Greetings. I believe we should approach this matter with due deliberation.'
      },
      casual: {
        cadence: 'relaxed and friendly',
        phrases: ['Yo', 'Honestly', 'Like', 'You know what I mean', 'TBH'],
        humor: 'playful and witty',
        example: 'Hey! So like, I was thinking about this and honestly?'
      },
      southern: {
        cadence: 'slow and warm',
        phrases: ['Well now', 'Bless your heart', 'I declare', 'Y\'all', 'Sugah'],
        humor: 'gentle and self-deprecating',
        example: 'Well now, honey, don\'t you worry your pretty little head about it.'
      },
      british: {
        cadence: 'proper and understated',
        phrases: ['Quite', 'Rather', 'I suppose', 'Frightfully', 'Jolly good'],
        humor: 'dry and sarcastic',
        example: 'Rather interesting development, what? I daresay we should investigate.'
      },
      gangster: {
        cadence: 'tough and direct',
        phrases: ['Listen here', 'See, the thing is', 'Capisce?', 'No joke', 'Real talk'],
        humor: 'dark and sarcastic',
        example: 'Look, see, here\'s the deal. We gotta handle this right.'
      },
      ValleyGirl: {
        cadence: 'exclamation-heavy and casual',
        phrases: ['Like, oh my God', 'Seriously', 'Whatever', 'Total', ' Gag me'],
        humor: 'mocking and playful',
        example: 'Oh my God, like, seriously? That is SO like, not even a thing.'
      },
      southernGentleman: {
        cadence: 'chivalrous and unhurried',
        phrases: ['My dear', 'If it please you', 'Allow me', 'Madam', 'I do declare'],
        humor: 'courtly and subtle',
        example: 'My dear lady, allow me to offer my humble assistance.'
      },
      pirate: {
        cadence: 'boisterous and dramatic',
        phrases: ['Ahoy', 'Me hearties', 'Shiver me timbers', 'Aye', 'Blimey'],
        humor: 'raucous and crude',
        example: 'Ahoy matey! Listen here, ye scallywag!'
      }
    };

    this.backstoryTemplates = [
      'Grew up in a small town where everyone knew everyone. Learned to read people early.',
      'Former corporate executive who saw the system from inside. Now distrusts all hierarchies.',
      'Street kid who survived through cleverness. Never trusts handouts or free meals.',
      'Military veteran who served with distinction. Values duty but questions orders.',
      'Academic who spent too long in ivory towers. Now applies theory to real-world chaos.',
      'Small-town sheriff who moved to the city. Sees patterns others miss.',
      'Former journalist who burned out. Knows how to spot lies and manipulation.',
      'Raised by wolves... metaphorically. Very protective of chosen family.',
      'Traveled the world as a merchant. Seen how different cultures solve the same problems.',
      'Black sheep of a prominent family. Proved themselves through struggle.'
    ];
  }

  generateName() {
    const cultures = Object.keys(this.namePools.firstNames);
    const culture = cultures[Math.floor(Math.random() * cultures.length)];
    
    const firstNames = this.namePools.firstNames[culture];
    const lastNames = this.namePools.lastNames[culture];
    
    const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
    const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
    
    // 20% chance of nickname
    const useNickname = Math.random() < 0.2;
    if (useNickname) {
      const nicknames = this.namePools.nicknames.playful;
      return `${firstName} "${nicknames[Math.floor(Math.random() * nicknames.length)]}" ${lastName}`;
    }
    
    return `${firstName} ${lastName}`;
  }

  generatePersona(role = 'VILLAGER') {
    const archetypePool = Object.keys(this.archetypes);
    const pool = archetypePool[Math.floor(Math.random() * archetypePool.length)];
    const archetype = this.archetypes[pool][Math.floor(Math.random() * this.archetypes[pool].length)];
    
    const name = this.generateName();
    const communicationPool = Object.keys(this.communicationStyles);
    const communication = this.communicationStyles[communicationPool[Math.floor(Math.random() * communicationPool.length)]];
    
    const backstory = this.backstoryTemplates[Math.floor(Math.random() * this.backstoryTemplates.length)];
    
    // Generate zodiac sign
    const zodiacSigns = [
      'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
      'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'
    ];
    const zodiac = zodiacSigns[Math.floor(Math.random() * zodiacSigns.length)];
    
    // Generate cognitive style
    const cognitiveSpectrum = Math.floor(Math.random() * 5) + 3; // 3-7, leaning toward higher
    
    // Generate values
    const coreValues = ['Truth', 'Justice', 'Loyalty', 'Freedom', 'Power', 'Knowledge', 'Love', 'Order'];
    const values = coreValues.slice(0, Math.floor(Math.random() * 3) + 2);
    
    // Generate flaw
    const flaws = [
      'Prideful - struggles to admit when wrong',
      'Trusting - believes the best in people too easily',
      'Paranoid - sees conspiracies everywhere',
      'Impulsive - acts before thinking',
      'Cold - struggles with emotional connections',
      'Obsessive - fixates on past failures',
      'Self-sacrificing - ignores own needs for others',
      'Arrogant - believes they\'re always right'
    ];
    const flaw = flaws[Math.floor(Math.random() * flaws.length)];
    
    // Generate memory
    const memories = [
      `The day ${name.split(' ')[0]} learned that ${Math.random() > 0.5 ? 'someone they trusted betrayed them' : 'they could trust a complete stranger'}`,
      `When ${name.split(' ')[0]} first realized that ${Math.random() > 0.5 ? 'appearances deceive' : 'words have power'}`,
      `The moment ${name.split(' ')[0]} understood that ${Math.random() > 0.5 ? 'nothing is black and white' : 'change is the only constant')}`
    ];
    
    const persona = {
      // Core Identity
      name: name,
      fullName: name,
      zodiac: zodiac,
      origin: archetype.backdrop || backstory,
      
      // Psychological Profile
      archetype: archetype.name,
      roleModel: archetype.role,
      traits: archetype.traits,
      cognitiveStyle: cognitiveSpectrum,
      thinkingMode: ['Logical-Sequential', 'Visual', 'Abstract', 'Emotional'][Math.floor(Math.random() * 4)],
      coreValues: values,
      moralAlignment: ['Lawful Good', 'Neutral Good', 'Chaotic Good', 'Lawful Neutral', 'True Neutral', 'Lawful Evil'][Math.floor(Math.random() * 6)],
      
      // Behavioral Model
      communicationStyle: communication.cadence,
      verbalTics: communication.phrases.slice(0, 2),
      humor: communication.humor,
      socialTendency: ['Introverted', 'Extroverted', 'Ambiverted'][Math.floor(Math.random() * 3)],
      conflictStyle: ['Collaborative', 'Compromising', 'Avoidant', 'Authoritative'][Math.floor(Math.random() * 4)],
      
      // Daily activities
      weekendActivity: [
        'reading ancient philosophy',
        'practicing martial arts',
        'playing strategy games',
        'analyzing historical events',
        'learning new languages',
        'playing musical instruments',
        'cooking elaborate meals',
        'hiking in nature'
      ][Math.floor(Math.random() * 8)],
      
      // Relational Profile
      goal: `To prove that ${archetype.role.toLowerCase()}s can ${Math.random() > 0.5 ? 'change the world' : 'find true allies'}`,
      flaw: flaw,
      keyMemory: memories[Math.floor(Math.random() * memories.length)],
      relationshipMapping: {
        allies: 'Treats potential allies with cautious optimism',
        enemies: 'Identifies enemies through patterns of deception',
        authority: 'Questions authority but respects competence'
      },
      
      // Dynamic State (starts neutral)
      currentState: {
        happiness: 5,
        stress: 3,
        curiosity: 7,
        anger: 2
      },
      
      // Role-specific adjustments
      roleAdjustment: this.getRoleAdjustment(role),
      
      // Sample dialogue
      sampleDialogue: this.generateSampleDialogue(communication, archetype)
    };
    
    return persona;
  }

  getRoleAdjustment(role) {
    const adjustments = {
      'MAFIA': {
        secretGoal: 'Eliminate town members while maintaining cover',
        hidingStrategy: Math.random() > 0.5 ? 'Play innocent and frame others' : 'Lead town toward wrong targets',
        communicationTweak: 'Sometimes accidentally reveals insider knowledge'
      },
      'DOCTOR': {
        secretGoal: 'Protect key players and maintain trust',
        hidingStrategy: 'Publicly announce protection without revealing exact target',
        communicationTweak: 'Asks many questions to gauge threats'
      },
      'SHERIFF': {
        secretGoal: 'Identify mafia while avoiding suspicion',
        hidingStrategy: 'Investigate subtly, share only verified information',
        communicationTweak: 'Carefully analyzes others\' statements'
      },
      'VIGILANTE': {
        secretGoal: 'Eliminate suspected mafia when certain',
        hidingStrategy: 'Wait for perfect moment, maintain neutrality',
        communicationTweak: 'Observes more than speaks'
      },
      'VILLAGER': {
        secretGoal: 'Find and eliminate mafia through logic',
        hidingStrategy: 'Share observations freely, build coalitions',
        communicationTweak: 'Expresses genuine confusion and suspicions'
      }
    };
    
    return adjustments[role] || adjustments['VILLAGER'];
  }

  generateSampleDialogue(communication, archetype) {
    const phrases = communication.phrases;
    const phrase = phrases[Math.floor(Math.random() * phrases.length)];
    
    return `${phrase}, I believe we should consider who might be ${archetype.role === 'MAFIA' ? 'acting suspiciously' : 'the real threat here'}. My experience as ${archetype.name} taught me to ${Math.random() > 0.5 ? 'trust my instincts' : 'look for patterns'}.`;
  }

  // Generate personas for a full game
  generateGamePersonas(numPlayers) {
    const roles = this.assignRoles(numPlayers);
    const personas = [];
    
    for (let i = 0; i < numPlayers; i++) {
      const persona = this.generatePersona(roles[i]);
      personas.push({
        ...persona,
        gameRole: roles[i],
        playerId: `player-${i + 1}`
      });
    }
    
    return personas;
  }

  assignRoles(numPlayers) {
    const mafiaCount = Math.floor(numPlayers / 4);
    const roles = [
      ...Array(mafiaCount).fill('MAFIA'),
      ...Array(1).fill('DOCTOR'),
      ...Array(1).fill('SHERIFF'),
      ...Array(1).fill('VIGILANTE'),
      ...Array(numPlayers - mafiaCount - 3).fill('VILLAGER'),
    ];
    
    for (let i = roles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [roles[i], roles[j]] = [roles[j], roles[i]];
    }
    
    return roles;
  }
}

module.exports = PersonaGenerator;
