// Default scoring rubric — "Innovations with AI" Micro- and Midi-Grants (Spring 2027 cycle).
// The coordinator can edit this from Settings → Rubric; edits are saved to the database
// and override this file. Keys must never change once reviews exist.
window.DEFAULT_RUBRIC = {
  levels: [
    { v: 4, label: 'Excellent' },
    { v: 3, label: 'Good' },
    { v: 2, label: 'Satisfactory' },
    { v: 1, label: 'Incomplete / Poor' },
    { v: 0, label: 'Missing' }
  ],
  criteria: [
    {
      key: 'competency', gate: true, weight: 3, section: 'B',
      name: 'Competency Targeted (and how students will demonstrate it)',
      desc: {
        4: 'Chosen competency(ies) are made clear and plans for both instruction to and demonstration by students are clear and robust',
        3: 'Chosen competency(ies) are made clear and plans for instruction to or demonstration by students are clear and robust',
        2: 'Chosen competency(ies) are made clear and plans for both instruction to and demonstration by students are present but flawed/unclear',
        1: 'Chosen competency(ies) are made clear and plans for both instruction to or demonstration by students incomplete or missing',
        0: 'Chosen competency(ies) are missing'
      },
      guidance: 'Every project must target Domain 1 (Critical Evaluation). Midi proposals must target at least two additional domains. A score of 0 here makes a proposal ineligible for funding.'
    },
    {
      key: 'impact', weight: 2, section: 'C & E',
      name: 'Meaningful, High-Impact Student AI Use and Evidence of Gain',
      desc: {
        4: 'Student use of AI is well planned and designed around best practices; the proposal states what students will be able to do afterward that they cannot do now, and names the work product that will show it.',
        3: 'Student use of AI is sufficiently planned and meaningful; the intended gain is stated but the evidence that will show it is thin.',
        2: 'Student use of AI is likely to be meaningful; the intended gain is implied rather than stated, or no work product is identified.',
        1: 'Evidence of design, meaningful experience, or intended gain is questionable.',
        0: 'Neither the design of student AI use nor the intended gain is described.'
      },
      guidance: 'Judge the clarity of the intended gain and the credibility of the work product that will show it. Applicants are not expected to submit a finished instrument; those are built with the initiative director after award.'
    },
    {
      key: 'integration', weight: 2, section: 'C',
      name: 'AI Integration into Course or Curriculum',
      desc: {
        4: 'AI use and/or training is seamlessly integrated into the course or curriculum (AI proficiency appears in revised or new CLOs and is assessed as part of course grading)',
        3: 'AI use and/or training occurs throughout course or curriculum but as isolated modules',
        2: 'AI use and/or training occurs as a siloed unit of the course or curriculum, not integrated with other learning',
        1: 'AI integration is vague/unclear',
        0: 'AI integration is not described'
      },
      guidance: ''
    },
    {
      key: 'scaffolding', weight: 2, section: 'C',
      name: 'Scaffolding of Knowledge / Proficiencies',
      desc: {
        4: 'AI training is intentionally scaffolded with formative assessments embedded for identification of mitigation and retraining needs',
        3: 'AI training is intentionally scaffolded but without formative assessments embedded',
        2: 'AI training is loosely scaffolded but inconsistencies exist',
        1: 'Evidence of genuine skills training scaffolding is questionable',
        0: 'Scaffolding is not addressed'
      },
      guidance: ''
    },
    {
      key: 'workplace', weight: 1, section: 'D',
      name: 'Integrated with Demonstrated Workplace Applications',
      desc: {
        4: 'Students perform authentic, field-specific tasks that build named workplace AI competencies; the connection is supported by external evidence (employer, alumni, accreditor, professional standard or job-market data); students can articulate and document what they gained',
        3: 'Students perform authentic, field-specific tasks that build named workplace AI competencies, but external grounding or student-facing documentation is thin',
        2: 'Workplace relevance is described in general terms, or the tasks are only loosely connected to professional practice in the field',
        1: 'Workplace relevance is asserted but vague or unclear',
        0: 'Workplace relevance is not addressed'
      },
      guidance: 'See Appendix B of the RFP (BHEF AI-Enabled Professional framework). A single guest speaker, a bare claim that "employers want AI skills", or tool training with no professional context does not meet this criterion on its own.'
    },
    {
      key: 'students', weight: 1, section: 'A', tiered: true,
      name: 'Number of Students Impacted',
      desc: {
        4: 'Midi: more than 100 students · Micro: more than 40 students',
        3: 'Midi: 30–100 students · Micro: 10–40 students',
        2: 'Midi: fewer than 30 students · Micro: fewer than 10 students',
        1: 'Student impact vague/unclear',
        0: 'Student impact not addressed'
      },
      guidance: 'Thresholds differ by tier; check the proposal’s tier shown at the top of this form.'
    },
    {
      key: 'feasibility', weight: 1, section: 'F',
      name: 'Feasibility and Sustainability',
      desc: {
        4: 'Proposal is entirely feasible as described and a complete plan for sustainability is provided',
        3: 'Proposal is entirely feasible as described; sustainability is addressed but questionable',
        2: 'Likely feasible; sustainability partially addressed',
        1: 'Feasibility is possible, but questionable',
        0: 'Feasibility is doubtful'
      },
      guidance: ''
    },
    {
      key: 'budget', weight: 1, section: 'Budget',
      name: 'Budget Justification',
      desc: {
        4: 'Budget is completely itemized and all line items are fully justified',
        3: 'Budget is completely itemized and justification is partial',
        2: 'Budget is not line itemized; some basic justification is present',
        1: 'Budget is not itemized; justification is absent',
        0: 'A budget is not provided'
      },
      guidance: 'Most awards are expected to be a stipend alone. Travel, food, student wages, and costs after Summer 2027 are not allowable (RFP §6).'
    }
  ],
  bonuses: [
    { key: 'bonus_dfw', points: 2, section: 'A', name: 'Addresses DFW and/or retention improvement (UG or Grad)' },
    { key: 'bonus_across', points: 1, section: 'A & C', name: 'Spans more than one course or a curriculum' },
    { key: 'bonus_sustained', points: 1, section: 'F', name: 'Data-supported estimate of sustained student impact beyond the grant period' }
  ]
};
