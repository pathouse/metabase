import React, { Component, PropTypes } from "react";
import ReactDOM from "react-dom";
import S from "./ExpressionEditorTextfield.css";

import _ from "underscore";
import cx from "classnames";

import { compile, suggest } from "metabase/lib/expressions/parser";
import { format } from "metabase/lib/expressions/formatter";
import { setCaretPosition, getSelectionPosition } from "metabase/lib/dom";

import Popover from "metabase/components/Popover.jsx";

import TokenizedInput from "./TokenizedInput.jsx";

import { isExpression } from "metabase/lib/expressions";


const KEYCODE_ENTER = 13;
const KEYCODE_ESC   = 27;
const KEYCODE_LEFT  = 37;
const KEYCODE_UP    = 38;
const KEYCODE_RIGHT = 39;
const KEYCODE_DOWN  = 40;


export default class ExpressionEditorTextfield extends Component {
    constructor(props, context) {
        super(props, context);
        _.bindAll(this, '_triggerAutosuggest', 'onInputKeyDown', 'onInputBlur', 'onSuggestionAccepted', 'onSuggestionMouseDown');
    }

    static propTypes = {
        expression: PropTypes.array,      // should be an array like [parsedExpressionObj, expressionString]
        tableMetadata: PropTypes.object.isRequired,
        customFields: PropTypes.object,
        onChange: PropTypes.func.isRequired,
        onError: PropTypes.func.isRequired,
        startRule: PropTypes.string.isRequired
    };

    static defaultProps = {
        expression: [null, ""],
        startRule: "expression",
        placeholder: "write some math!"
    }

    componentWillMount() {
        this.componentWillReceiveProps(this.props);
    }

    componentWillReceiveProps(newProps) {
        // we only refresh our state if we had no previous state OR if our expression or table has changed
        if (!this.state || this.props.expression != newProps.expression || this.props.tableMetadata != newProps.tableMetadata) {
            let parsedExpression = newProps.expression;
            let expressionString = format(newProps.expression, {
                tableMetadata: newProps.tableMetadata,
                customFields: newProps.customFields,
            });
            let expressionErrorMessage = null;
            let suggestions = [];
            try {
                if (expressionString) {
                    compile(expressionString, {
                        tableMetadata: newProps.tableMetadata,
                        customFields: newProps.customFields,
                        startRule: newProps.startRule
                    });
                }
            } catch (e) {
                expressionErrorMessage = e;
            }

            this.setState({
                parsedExpression,
                expressionString,
                expressionErrorMessage,
                suggestions,
                highlightedSuggestion: 0
            });
        }
    }

    componentDidMount() {
        this._setCaretPosition(this.state.expressionString.length, this.state.expressionString.length === 0)
    }

    onSuggestionAccepted() {
        const { expressionString } = this.state;
        const suggestion = this.state.suggestions[this.state.highlightedSuggestion];

        if (suggestion) {
            let prefix = expressionString.slice(0, suggestion.index);
            if (suggestion.prefixTrim) {
                prefix = prefix.replace(suggestion.prefixTrim, "");
            }
            let postfix = expressionString.slice(suggestion.index);
            if (suggestion.postfixTrim) {
                postfix = postfix.replace(suggestion.postfixTrim, "");
            }
            if (!postfix && suggestion.postfixText) {
                postfix = suggestion.postfixText;
            }

            this.onExpressionChange(prefix + suggestion.text + postfix)
            setTimeout(() => this._setCaretPosition((prefix + suggestion.text).length, true))
        }

        this.setState({
            highlightedSuggestion: 0
        });
    }

    onSuggestionMouseDown(event, index) {
        // when a suggestion is clicked, we'll highlight the clicked suggestion and then hand off to the same code that deals with ENTER / TAB keydowns
        event.preventDefault();
        event.stopPropagation();
        this.setState({ highlightedSuggestion: index }, this.onSuggestionAccepted);
    }

    onInputKeyDown(event) {
        const { suggestions, highlightedSuggestion } = this.state;

        if (event.keyCode === KEYCODE_LEFT || event.keyCode === KEYCODE_RIGHT) {
            setTimeout(() => this._triggerAutosuggest());
            return;
        }
        if (event.keyCode === KEYCODE_ESC) {
            this.clearSuggestions();
            return;
        }

        if (!suggestions.length) {
            return;
        }
        if (event.keyCode === KEYCODE_ENTER) {
            this.onSuggestionAccepted();
            event.preventDefault();
        } else if (event.keyCode === KEYCODE_UP) {
            this.setState({
                highlightedSuggestion: (highlightedSuggestion + suggestions.length - 1) % suggestions.length
            });
            event.preventDefault();
        } else if (event.keyCode === KEYCODE_DOWN) {
            this.setState({
                highlightedSuggestion: (highlightedSuggestion + suggestions.length + 1) % suggestions.length
            });
            event.preventDefault();
        }
    }

    clearSuggestions() {
        this.setState({
            suggestions: [],
            highlightedSuggestion: 0
        });
    }

    onInputBlur() {
        this.clearSuggestions();

        // whenever our input blurs we push the updated expression to our parent if valid
        if (isExpression(this.state.parsedExpression)) {
            this.props.onChange(this.state.parsedExpression);
        } else if (this.state.expressionErrorMessage) {
            this.props.onError(this.state.expressionErrorMessage);
        } else {
            this.props.onError({ message: "Invalid expression" });
        }
    }

    onInputClick = () => {
        this._triggerAutosuggest();
    }

    _triggerAutosuggest = () => {
        this.onExpressionChange(this.state.expressionString);
    }

    _setCaretPosition = (position, autosuggest) => {
        setCaretPosition(ReactDOM.findDOMNode(this.refs.input), position);
        if (autosuggest) {
            setTimeout(() => this._triggerAutosuggest());
        }
    }

    onExpressionChange(expressionString) {
        let inputElement = ReactDOM.findDOMNode(this.refs.input);
        if (!inputElement) {
            return;
        }

        let expressionErrorMessage = null;
        let suggestions           = [];
        let parsedExpression;

        try {
            parsedExpression = compile(expressionString, {
                tableMetadata: this.props.tableMetadata,
                customFields: this.props.customFields,
                startRule: this.props.startRule
            })
        } catch (e) {
            expressionErrorMessage = e;
            console.error("expression error:", expressionErrorMessage);
        }

        const isValid = parsedExpression && parsedExpression.length > 0;
        const [selectionStart, selectionEnd] = getSelectionPosition(inputElement);
        const hasSelection = selectionStart !== selectionEnd;
        const isAtEnd = selectionEnd === expressionString.length;
        const endsWithWhitespace = /\s$/.test(expressionString);

        // don't show suggestions if
        // * there's a section
        // * we're at the end of a valid expression, unless the user has typed another space
        if (!hasSelection && !(isValid && isAtEnd && !endsWithWhitespace)) {
            try {
                suggestions = suggest(expressionString, {
                    tableMetadata: this.props.tableMetadata,
                    customFields: this.props.customFields,
                    startRule: this.props.startRule,
                    index: selectionEnd
                })
            } catch (e) {
                console.error("suggest error:", e);
            }
        }

        this.setState({
            expressionErrorMessage,
            expressionString,
            parsedExpression,
            suggestions
        });
    }

    render() {
        let errorMessage = this.state.expressionErrorMessage;
        if (errorMessage && !errorMessage.length) errorMessage = 'unknown error';

        const { placeholder } = this.props;
        const { suggestions } = this.state;

        return (
            <div className={cx(S.editor, "relative")}>
                <TokenizedInput
                    ref="input"
                    className={cx(S.input, "my1 input block full", { "border-error": errorMessage })}
                    type="text"
                    placeholder={placeholder}
                    value={this.state.expressionString}
                    onChange={(e) => this.onExpressionChange(e.target.value)}
                    onKeyDown={this.onInputKeyDown}
                    onBlur={this.onInputBlur}
                    onFocus={(e) => this._triggerAutosuggest()}
                    onClick={this.onInputClick}
                    autoFocus
                />
                <div className={cx(S.equalSign, "spread flex align-center h4 text-dark", { [S.placeholder]: !this.state.expressionString })}>=</div>
                { suggestions.length ?
                    <Popover
                        className="pb1 not-rounded border-dark"
                        hasArrow={false}
                        tetherOptions={{
                            attachment: 'top left',
                            targetAttachment: 'bottom left'
                        }}
                    >
                        <ul style={{minWidth: 150, overflow: "hidden"}}>
                            {suggestions.map((suggestion, i) =>
                                // insert section title. assumes they're sorted by type
                                [(i === 0 || suggestion.type !== suggestions[i - 1].type) &&
                                    <li className="mx2 h6 text-uppercase text-bold text-grey-3 py1 pt2">
                                        {suggestion.type}
                                    </li>
                                ,
                                    <li style={{ paddingTop: 5, paddingBottom: 5 }}
                                        className={cx("px2 cursor-pointer text-white-hover bg-brand-hover", {"text-white bg-brand": i === this.state.highlightedSuggestion})}
                                        onMouseDownCapture={(e) => this.onSuggestionMouseDown(e, i)}
                                    >
                                        { suggestion.prefixLength ?
                                            <span>
                                                <span className={cx("text-brand text-bold", {"text-white bg-brand": i === this.state.highlightedSuggestion})}>{suggestion.name.slice(0, suggestion.prefixLength)}</span>
                                                <span>{suggestion.name.slice(suggestion.prefixLength)}</span>
                                            </span>
                                        :
                                            suggestion.name
                                        }
                                    </li>
                                ]
                            )}
                        </ul>
                    </Popover>
                : null}
            </div>
        );
    }
}
